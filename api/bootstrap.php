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
    apply_migrations($pdo);
    return $pdo;
}

function apply_migrations(PDO $pdo): void
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    $files = glob(dirname(__DIR__) . '/migrations/[0-9][0-9][0-9]-*.sql') ?: [];
    sort($files, SORT_STRING);
    foreach ($files as $file) {
        $version = pathinfo($file, PATHINFO_FILENAME);
        $exists = $pdo->prepare('SELECT 1 FROM schema_migrations WHERE version = ?');
        $exists->execute([$version]);
        if ($exists->fetchColumn()) {
            continue;
        }
        $migration = file_get_contents($file);
        if ($migration === false) {
            throw new RuntimeException("Migration file is not readable: {$file}");
        }
        $pdo->beginTransaction();
        try {
            $pdo->exec($migration);
            $pdo->prepare('INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)')->execute([$version, now_sql()]);
            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }
}

function json_response(array $body, int $status = 200): never
{
    security_headers();
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'");
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
    start_session();
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_set_cookie_params([
        'httponly' => true,
        'secure' => $https,
        'samesite' => 'Lax',
        'path' => '/',
    ]);
    session_start();
}

function public_registration_enabled(PDO $pdo): bool
{
    $configured = env_value('STOCK_HOLD_ALLOW_REGISTRATION');
    if ($configured !== null) {
        return in_array(strtolower($configured), ['1', 'true', 'yes', 'on'], true);
    }
    return ((int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn()) === 0;
}

function current_user(PDO $pdo): ?array
{
    start_session();
    $userId = $_SESSION['user_id'] ?? null;
    if (!$userId) {
        $expected = env_value('STOCK_HOLD_API_TOKEN');
        $provided = $_SERVER['HTTP_X_API_TOKEN'] ?? '';
        if ($expected === null || $expected === '' || $provided === '' || !hash_equals($expected, $provided)) {
            return null;
        }
        $userId = $pdo->query('SELECT id FROM users ORDER BY id LIMIT 1')->fetchColumn();
    }
    if (!$userId) {
        return null;
    }
    $stmt = $pdo->prepare('SELECT id,username,email,failed_login_attempts,locked_until,created_at,updated_at FROM users WHERE id=?');
    $stmt->execute([(int)$userId]);
    $user = $stmt->fetch();
    if (!$user) {
        unset($_SESSION['user_id']);
        return null;
    }
    return $user;
}

function require_authenticated_user(PDO $pdo): array
{
    $user = current_user($pdo);
    if (!$user) {
        envelope_error('UNAUTHORIZED', 'Authentication required.', 401);
    }
    return $user;
}

function require_write_access(PDO $pdo): array
{
    $user = require_authenticated_user($pdo);
    $expected = env_value('STOCK_HOLD_API_TOKEN');
    $provided = $_SERVER['HTTP_X_API_TOKEN'] ?? '';
    if ($expected !== null && $expected !== '' && $provided !== '' && hash_equals($expected, $provided)) {
        return $user;
    }

    $csrf = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if ($csrf !== '' && hash_equals(csrf_token(), $csrf)) {
        return $user;
    }
    envelope_error('UNAUTHORIZED', 'Mutation requires API token or CSRF token.', 401);
}

function require_csrf_token(): void
{
    $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if ($provided === '' || !hash_equals(csrf_token(), $provided)) {
        envelope_error('UNAUTHORIZED', 'CSRF token is required.', 401);
    }
}

function client_ip(): string
{
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'), 0, 64);
}

function rate_limit_key(string $scope, string $value): string
{
    return $scope . ':' . hash('sha256', strtolower(trim($value)));
}

function is_rate_limited(PDO $pdo, string $key): bool
{
    $stmt = $pdo->prepare('SELECT locked_until FROM auth_rate_limits WHERE scope_key=?');
    $stmt->execute([$key]);
    $locked = $stmt->fetchColumn();
    return is_string($locked) && $locked !== '' && strtotime($locked) > time();
}

function record_failed_login(PDO $pdo, string $key): void
{
    $now = time();
    $stmt = $pdo->prepare('SELECT failed_attempts,window_started_at FROM auth_rate_limits WHERE scope_key=?');
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    $window = $row && (strtotime($row['window_started_at']) ?: 0) > $now - 900
        ? (int)$row['failed_attempts'] + 1 : 1;
    $started = gmdate('Y-m-d H:i:s', $row && $window > 1 ? strtotime($row['window_started_at']) : $now);
    $locked = $window >= 5 ? gmdate('Y-m-d H:i:s', $now + 900) : null;
    $upsert = $pdo->prepare('INSERT INTO auth_rate_limits(scope_key,failed_attempts,window_started_at,locked_until) VALUES(?,?,?,?) ON CONFLICT(scope_key) DO UPDATE SET failed_attempts=excluded.failed_attempts,window_started_at=excluded.window_started_at,locked_until=excluded.locked_until');
    $upsert->execute([$key, $window, $started, $locked]);
}

function clear_login_limits(PDO $pdo, string $key): void
{
    $pdo->prepare('DELETE FROM auth_rate_limits WHERE scope_key=?')->execute([$key]);
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
