<?php
declare(strict_types=1);

const STOCK_HOLD_VERSION = '2.0.0-apache';

function env_value(string $key, ?string $default = null): ?string
{
    $value = getenv($key);
    if ($value !== false && $value !== '') {
        return $value;
    }

    $envFile = dirname(__DIR__) . '/.env';
    if (is_readable($envFile)) {
        foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
                continue;
            }
            [$name, $raw] = explode('=', $line, 2);
            if (trim($name) === $key) {
                return trim($raw, " \t\r\n\"'");
            }
        }
    }
    return $default;
}

function runtime_dir(): string
{
    $configured = env_value('STOCK_HOLD_RUNTIME_DIR');
    $dir = $configured ?: dirname(__DIR__) . '/runtime';
    if (!is_dir($dir)) {
        mkdir($dir, 0770, true);
    }
    return $dir;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $path = runtime_dir() . DIRECTORY_SEPARATOR . 'stock_hold.sqlite';
    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    // Apache requests must work immediately after deployment.  The CLI
    // migration remains the explicit operational command, while this
    // idempotent bootstrap prevents a first request from failing on a fresh
    // runtime directory.
    $migration = file_get_contents(dirname(__DIR__) . '/migrations/001-initial.sql');
    if ($migration === false) {
        throw new RuntimeException('Initial migration file is not readable.');
    }
    $pdo->exec($migration);
    $mark = $pdo->prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(?, ?)');
    $mark->execute(['001-initial', now_sql()]);
    return $pdo;
}

function json_response(array $body, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function request_id(): string
{
    return bin2hex(random_bytes(16));
}

function envelope_ok(mixed $data, int $status = 200): never
{
    json_response([
        'status' => 'ok',
        'data' => $data,
        'error' => null,
        'meta' => ['request_id' => request_id(), 'ts' => gmdate('c')],
    ], $status);
}

function envelope_error(string $code, string $message, int $status = 400, mixed $detail = null): never
{
    json_response([
        'status' => 'error',
        'data' => null,
        'error' => ['code' => $code, 'message' => $message, 'detail' => $detail],
        'meta' => ['request_id' => request_id(), 'ts' => gmdate('c')],
    ], $status);
}

function body_json(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if (strlen($raw) > 1048576) {
        envelope_error('BODY_TOO_LARGE', 'Request body exceeds 1 MiB.', 413);
    }
    if ($raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        envelope_error('INVALID_JSON', 'Request body must be a JSON object.', 400);
    }
    return $data;
}

function require_fields(array $data, array $fields): void
{
    foreach ($fields as $field) {
        if (!array_key_exists($field, $data) || $data[$field] === '' || $data[$field] === null) {
            envelope_error('VALIDATION_ERROR', "Missing field: {$field}", 422);
        }
    }
}

function csrf_token(): string
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start(['cookie_httponly' => true, 'cookie_samesite' => 'Lax']);
    }
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function require_write_access(): void
{
    $expected = env_value('STOCK_HOLD_API_TOKEN');
    $provided = $_SERVER['HTTP_X_API_TOKEN'] ?? '';
    if ($expected !== null && $expected !== '' && hash_equals($expected, $provided)) {
        return;
    }

    $csrf = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if ($csrf !== '' && hash_equals(csrf_token(), $csrf)) {
        return;
    }
    envelope_error('UNAUTHORIZED', 'Mutation requires API token or CSRF token.', 401);
}

function now_sql(): string
{
    return gmdate('Y-m-d H:i:s');
}

function uuid(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
}

function decimal(mixed $value, string $default = '0'): string
{
    if ($value === null || $value === '') {
        return $default;
    }
    if (!is_numeric($value)) {
        envelope_error('VALIDATION_ERROR', 'Numeric field is invalid.', 422);
    }
    return (string)$value;
}

function list_data(array $items, int $page = 1, int $pageSize = 25): array
{
    $total = count($items);
    return [
        'items' => $items,
        'pagination' => [
            'total' => $total,
            'page' => $page,
            'page_size' => $pageSize,
            'total_pages' => max(1, (int)ceil($total / max(1, $pageSize))),
        ],
    ];
}
