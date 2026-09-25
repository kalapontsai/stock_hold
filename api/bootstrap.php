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
    // F-05 fix: HSTS so browsers refuse to downgrade HTTP→HTTPS after first
    // visit. 2 years + includeSubDomains + preload — operator must register
    // the domain at hstspreload.org to actually push to the browser list.
    header('Strict-Transport-Security: max-age=63072000; includeSubDomains; preload');
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
    // F-09 fix: prefer Cloudflare's CF-Visitor (JSON, hard to spoof) over
    // X-Forwarded-Proto (plain header, attacker can set when hitting origin
    // directly). Fall back to direct HTTPS detection for non-CF deployments.
    // X-Forwarded-Proto retained as a last resort for non-Cloudflare reverse
    // proxies — operators behind such proxies MUST strip client-supplied
    // X-Forwarded-Proto at the edge.
    $cfVisitor = (string)($_SERVER['HTTP_CF_VISITOR'] ?? '');
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || str_contains($cfVisitor, '"scheme":"https"')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_set_cookie_params([
        'httponly' => true,
        'secure' => $https,
        'samesite' => 'Lax',
        'path' => '/',
    ]);
    session_start();
}

function public_registration_enabled(PDO $pdo, ?string $initToken = null): bool
{
    $configured = env_value('STOCK_HOLD_ALLOW_REGISTRATION');
    if ($configured !== null) {
        return in_array(strtolower($configured), ['1', 'true', 'yes', 'on'], true);
    }
    if ((int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) {
        return false;
    }
    // F-03 fix: first-user bootstrap requires STOCK_HOLD_INIT_TOKEN.
    // Without this, an attacker who reaches a fresh deployment first can
    // claim the admin-equivalent first account.
    return validate_init_token((string)$initToken);
}

// F-01 fix: detect obvious placeholder values that operators might leave by
// copying .env.example verbatim. The repo is public, so the literal placeholder
// string in .env.example is publicly known. Without this check, an operator who
// forgets to replace STOCK_HOLD_API_TOKEN before deploy leaves a publicly known
// token that any reader of the repo can use.
//
// Matches:
//   - Exact placeholder strings ever shipped in .env.example
//   - Common patterns: replace / placeholder / changeme / your-token / *** /
//     TODO / FIXME / <angled> / example
function is_known_placeholder(?string $value): bool
{
    if (!is_string($value) || $value === '') {
        return false;
    }
    $normalized = strtolower(trim($value));

    // Exact-match placeholders shipped in .env.example history.
    // Update this list when changing .env.example placeholder.
    $exact = [
        '***',
        'replace-with-a-long-random-token',
        'replace-with-long-random-token',
        'replac…oken', // unicode ellipsis variant used in earlier .env.example
        'replace-with-openssl-rand-hex-32-output',
        'changeme',
        'your-token-here',
        'your-secret-token-here',
        'your_api_token',
        '<your-token>',
        '<token>',
        'todo',
        'fixme',
        'xxx',
    ];
    foreach ($exact as $e) {
        if (strtolower(trim($e)) === $normalized) {
            return true;
        }
    }

    // Pattern-match common placeholder keywords. Word-boundary aware.
    if (preg_match('/\b(replace|placeholder|change.?me|your.?token|your.?secret|example|TODO|FIXME|XXX|<.+?>)\b/i', $normalized)) {
        return true;
    }

    return false;
}

function current_user(PDO $pdo): ?array
{
    start_session();
    $userId = $_SESSION['user_id'] ?? null;
    if (!$userId) {
        $provided = $_SERVER['HTTP_X_API_TOKEN'] ?? '';
        if ($provided === '') {
            return null;
        }
        // Per-user API token lookup (migration 007):
        // Verify the token hash against the api_tokens table and
        // resolve to the owning user.  The legacy global
        // STOCK_HOLD_API_TOKEN is intentionally ignored here;
        // operators should migrate to per-user tokens.
        $tokenHash = hash('sha256', $provided);
        $stmt = $pdo->prepare('SELECT user_id FROM api_tokens WHERE token_hash = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > ?)');
        $stmt->execute([$tokenHash, gmdate('Y-m-d H:i:s')]);
        $tokenRow = $stmt->fetch();
        if (!$tokenRow) {
            return null;
        }
        $userId = (int)$tokenRow['user_id'];
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

    // F-06 fix: per-user write rate limit. Applied BEFORE the API-token / CSRF
    // bypass so automation scripts using X-API-Token cannot flood either.
    if (!check_write_rate_limit($pdo, (int)$user['id'])) {
        envelope_error('RATE_LIMITED', 'Too many write requests. Please slow down.', 429);
    }

    // F-07 fix: append-only audit trail. One row per authenticated mutation.
    $method = (string)($_SERVER['REQUEST_METHOD'] ?? 'UNK');
    $path = (string)($_SERVER['PATH_INFO'] ?? (parse_url((string)($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH) ?: ''));
    audit_log_write($pdo, (int)$user['id'], substr("{$method} {$path}", 0, 200));

    // Per-user API token authentication: no CSRF needed (designed for agent/script automation).
    $providedApiToken = $_SERVER['HTTP_X_API_TOKEN'] ?? '';
    if ($providedApiToken !== '') {
        return $user;
    }

    // Browser session: require CSRF token.
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

// F-06 fix: per-user write rate limit (fixed window, configurable via env).
// Returns true if the write is allowed; false if the user is over the quota.
// Distinct from auth_rate_limits which tracks failed login attempts.
function check_write_rate_limit(PDO $pdo, int $userId): bool
{
    $maxPerWindow = (int)(env_value('STOCK_HOLD_WRITE_RATE_MAX') ?? '60');
    $windowSeconds = max(1, (int)(env_value('STOCK_HOLD_WRITE_RATE_WINDOW') ?? '60'));
    $now = time();
    $windowStart = $now - ($now % $windowSeconds);
    $windowStartedAt = gmdate('Y-m-d H:i:s', $windowStart);

    $stmt = $pdo->prepare('SELECT write_count, window_started_at FROM write_rate_limits WHERE user_id=?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();

    if (!$row || $row['window_started_at'] !== $windowStartedAt) {
        // New window — start fresh with this write as count=1.
        $upsert = $pdo->prepare(
            'INSERT INTO write_rate_limits(user_id, window_started_at, write_count) VALUES(?, ?, 1)
             ON CONFLICT(user_id) DO UPDATE SET window_started_at=excluded.window_started_at, write_count=1'
        );
        $upsert->execute([$userId, $windowStartedAt]);
        return true;
    }

    if ((int)$row['write_count'] >= $maxPerWindow) {
        return false;
    }

    // Same window — increment.
    $pdo->prepare('UPDATE write_rate_limits SET write_count = write_count + 1 WHERE user_id=?')->execute([$userId]);
    return true;
}

// F-03 fix: validate init token for first-user bootstrap.
function validate_init_token(string $provided): bool
{
    $expected = env_value('STOCK_HOLD_INIT_TOKEN');
    // F-01 fix: a placeholder INIT_TOKEN from .env.example is publicly known.
    // Reject obvious placeholders so first-user registration stays disabled
    // until the operator runs `openssl rand -hex 32`.
    if (is_known_placeholder($expected)) {
        return false;
    }
    if ($expected === null || $expected === '' || $provided === '') {
        return false;
    }
    return hash_equals($expected, $provided);
}

// F-03 fix: register rate limit (per IP and per email, sliding window).
// Distinct from auth_rate_limits (which tracks FAILED login attempts).
function check_register_rate_limit(PDO $pdo, string $ip, string $email): bool
{
    $maxAttempts = max(1, (int)(env_value('STOCK_HOLD_REGISTER_MAX_PER_DAY') ?? '5'));
    $windowSeconds = max(60, (int)(env_value('STOCK_HOLD_REGISTER_WINDOW') ?? '86400'));
    $now = time();
    $windowStart = $now - $windowSeconds;
    $scopes = [
        ['ip', rate_limit_key('register-ip', $ip)],
        ['email', rate_limit_key('register-email', $email)],
    ];
    foreach ($scopes as [$scope, $key]) {
        $stmt = $pdo->prepare('SELECT attempt_count, first_attempt_at FROM register_rate_limits WHERE scope=? AND scope_key=?');
        $stmt->execute([$scope, $key]);
        $row = $stmt->fetch();

        if (!$row || strtotime($row['first_attempt_at']) < $windowStart) {
            // New window — reset.
            $upsert = $pdo->prepare(
                'INSERT INTO register_rate_limits(scope, scope_key, first_attempt_at, attempt_count) VALUES(?, ?, ?, 1)
                 ON CONFLICT(scope, scope_key) DO UPDATE SET first_attempt_at=excluded.first_attempt_at, attempt_count=1'
            );
            $upsert->execute([$scope, $key, gmdate('Y-m-d H:i:s', $now)]);
            continue;
        }

        if ((int)$row['attempt_count'] >= $maxAttempts) {
            return false; // Rate limited.
        }

        $pdo->prepare('UPDATE register_rate_limits SET attempt_count = attempt_count + 1 WHERE scope=? AND scope_key=?')
            ->execute([$scope, $key]);
    }
    return true;
}

// F-07 fix: append-only audit trail. Called from require_write_access and
// any handler that wants a finer-grained trail. Failures must NOT break the
// request — we log to stderr and continue.
function audit_log_write(PDO $pdo, int $userId, string $action, ?string $ip = null): void
{
    try {
        $stmt = $pdo->prepare('INSERT INTO audit_log(user_id, action, ip, ts) VALUES(?, ?, ?, ?)');
        $stmt->execute([$userId, $action, $ip ?? client_ip(), now_sql()]);
    } catch (Throwable $e) {
        // F-11 fix: class only, no message (PDOException message can leak
        // bound values and table structure into the error log).
        error_log('audit_log_write failed: ' . get_class($e));
    }
}

// F-12 fix: verify a Cloudflare Turnstile token against the siteverify API.
// Returns true if Turnstile is not configured (dev mode), true if the token
// verifies successfully, false if the token is missing/invalid.
//
// Dev mode behavior: when STOCK_HOLD_TURNSTILE_SECRET is empty, the check is
// skipped entirely. This makes local development possible without a Turnstile
// key. Production MUST set both STOCK_HOLD_TURNSTILE_SITEKEY and SECRET.
//
// Security: HTTPS-only, no redirect following (F-08 fix), short timeouts so a
// stalled Cloudflare call can't lock the auth flow.
function verify_turnstile(string $token, ?string $remoteIp = null): bool
{
    $secret = env_value('STOCK_HOLD_TURNSTILE_SECRET');
    $sitekey = env_value('STOCK_HOLD_TURNSTILE_SITEKEY');
    // Dev mode: Turnstile not configured -> skip verification.
    if (!is_string($secret) || $secret === '' || !is_string($sitekey) || $sitekey === '') {
        return true;
    }
    // Production: token must be present.
    if ($token === '') {
        return false;
    }

    $postData = [
        'secret' => $secret,
        'response' => $token,
    ];
    if ($remoteIp !== null && $remoteIp !== '') {
        $postData['remoteip'] = $remoteIp;
    }

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($postData),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_FOLLOWLOCATION => false, // F-08 fix: never follow redirects
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_USERAGENT => 'stock_hold/2.0.0-apache (F-12 Turnstile verifier)',
    ]);
    $response = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_errno($ch);
    curl_close($ch);

    if ($curlErr !== 0 || $httpCode !== 200 || !is_string($response) || $response === '') {
        // Fail-closed: if we can't reach Cloudflare, reject. Operator will see
        // this in error log and can decide whether to disable Turnstile.
        return false;
    }

    $data = json_decode($response, true);
    if (!is_array($data)) {
        return false;
    }
    return ($data['success'] ?? false) === true;
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

/* ---------- Update check (Settings → Maintenance → 檢查更新) ----------
 *
 * Backend proxy for GitHub Releases API. We do NOT let the browser call
 * api.github.com directly because:
 *   - CSP `connect-src 'self'` would block it.
 *   - Unauthenticated GitHub API is 60 req/hr per IP; cache once per hour
 *     so all users behind the same LiteSpeed share a single upstream call.
 *
 * Public endpoint — checking for a new release leaks nothing about the
 * caller, and login UX would be weird if it required auth.
 */
function update_repo(): string
{
    return env_value('STOCK_HOLD_UPDATE_REPO') ?: 'kalapontsai/stock_hold';
}

function update_cache_ttl(): int
{
    return max(60, (int)(env_value('STOCK_HOLD_UPDATE_CACHE_TTL') ?: 3600));
}

function update_cache_get(PDO $pdo, string $endpoint, int $ttl): ?array
{
    $stmt = $pdo->prepare('SELECT payload_json, fetched_at, expires_at FROM update_cache WHERE endpoint = ?');
    $stmt->execute([$endpoint]);
    $row = $stmt->fetch();
    if (!$row) return null;
    $expires = strtotime($row['expires_at']) ?: 0;
    return [
        'payload' => $row['payload_json'],
        'fetched_at' => $row['fetched_at'],
        'fresh' => $expires > time(),
    ];
}

function update_cache_put(PDO $pdo, string $endpoint, ?string $etag, string $payload, int $ttl): void
{
    $now = now_sql();
    $expires = gmdate('Y-m-d H:i:s', time() + $ttl);
    $stmt = $pdo->prepare('INSERT INTO update_cache(endpoint, etag, payload_json, fetched_at, expires_at) VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET etag=excluded.etag, payload_json=excluded.payload_json, fetched_at=excluded.fetched_at, expires_at=excluded.expires_at');
    $stmt->execute([$endpoint, $etag, $payload, $now, $expires]);
}

// Strip pre-release tag and convert "1.2.3-foo" → [1,2,3]. Treats the
// environment suffix (e.g. "2.0.0-apache") as equivalent to the bare
// version. Adequate for our use case; we don't need full semver precedence.
function version_tuple(string $v): array
{
    $base = preg_split('/[-+]/', $v, 2)[0] ?? '0';
    $parts = array_map('intval', explode('.', $base));
    while (count($parts) < 3) $parts[] = 0;
    return array_slice($parts, 0, 3);
}

// Returns -1 if a<b, 0 if equal, 1 if a>b.
function version_compare_simple(string $a, string $b): int
{
    $ta = version_tuple($a);
    $tb = version_tuple($b);
    for ($i = 0; $i < 3; $i++) {
        if ($ta[$i] < $tb[$i]) return -1;
        if ($ta[$i] > $tb[$i]) return 1;
    }
    return 0;
}

function update_check_respond(string $repo, array $payload, bool $stale, array $extra = []): never
{
    $base = [
        'current_version' => STOCK_HOLD_VERSION,
        'repo' => $repo,
        'stale' => $stale,
        'checked_at' => gmdate('c'),
    ];
    if (!empty($payload['no_releases']) || $payload['tag_name'] === '') {
        envelope_ok($base + [
            'latest_version' => null,
            'has_update' => false,
            'status' => 'no_releases',
            'message' => '此 repo 尚未發布任何 release。',
            'release_url' => "https://github.com/{$repo}/releases",
        ] + $extra);
    }
    $latest = (string)$payload['tag_name'];
    $hasUpdate = version_compare_simple(STOCK_HOLD_VERSION, $latest) < 0;
    envelope_ok($base + [
        'latest_version' => $latest,
        'has_update' => $hasUpdate,
        'status' => 'ok',
        'release_url' => (string)($payload['html_url'] ?? "https://github.com/{$repo}/releases/tag/{$latest}"),
        'published_at' => (string)($payload['published_at'] ?? ''),
        'summary' => (string)($payload['body'] ?? ''),
    ] + $extra);
}

function update_check(PDO $pdo): never
{
    $repo = update_repo();
    $ttl = update_cache_ttl();
    $endpoint = 'release_latest';

    $cached = update_cache_get($pdo, $endpoint, $ttl);
    $cachedPayload = null;
    $cachedFresh = false;
    if ($cached !== null) {
        $cachedPayload = json_decode((string)$cached['payload'], true);
        $cachedFresh = (bool)$cached['fresh'];
    }

    // Short-circuit on fresh cache. Without this, every button click burns
    // one GitHub request; with many active users we'd blow past the 60 req/hr
    // unauthenticated limit. Trade-off: a freshly-published release may take
    // up to STOCK_HOLD_UPDATE_CACHE_TTL seconds to appear — acceptable for a
    // self-hosted app where the user can clear cache or wait.
    if ($cachedFresh && is_array($cachedPayload) && isset($cachedPayload['tag_name'])) {
        update_check_respond($repo, $cachedPayload, false);
    }

    $url = "https://api.github.com/repos/{$repo}/releases/latest";
    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "User-Agent: stock_hold-update-check\r\nAccept: application/vnd.github+json\r\nX-GitHub-Api-Version: 2022-11-28\r\n",
            'timeout' => 10,
            'ignore_errors' => true,
        ],
    ]);
    $body = @file_get_contents($url, false, $ctx);
    $status = 0;
    if (isset($http_response_header[0]) && preg_match('/HTTP\/[\d.]+\s+(\d+)/', $http_response_header[0], $m)) {
        $status = (int)$m[1];
    }

    // 404 = repo exists but has no releases yet. This is an expected
    // state, not an error — cache the empty marker and report no_releases
    // so the frontend shows a friendly message instead of "HTTP 404".
    if ($status === 404) {
        $empty = ['tag_name' => '', 'no_releases' => true];
        update_cache_put($pdo, $endpoint, null, json_encode($empty), $ttl);
        update_check_respond($repo, $empty, false);
    }

    if (is_string($body) && $body !== '' && $status === 200) {
        $data = json_decode($body, true);
        if (is_array($data) && isset($data['tag_name'])) {
            $payload = [
                'tag_name' => (string)$data['tag_name'],
                'name' => (string)($data['name'] ?? $data['tag_name']),
                'published_at' => (string)($data['published_at'] ?? ''),
                'html_url' => (string)($data['html_url'] ?? ''),
                'body' => substr((string)($data['body'] ?? ''), 0, 2000),
            ];
            $etag = null;
            foreach ((array)$http_response_header as $h) {
                if (stripos($h, 'etag:') === 0) { $etag = trim(substr($h, 5)); break; }
            }
            update_cache_put($pdo, $endpoint, $etag, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $ttl);
            update_check_respond($repo, $payload, false);
        }
    }

    // Non-success other than 404 — fall back to cache (stale if expired)
    // so the user sees last-known data instead of a hard error.
    if (is_array($cachedPayload) && isset($cachedPayload['tag_name'])) {
        update_check_respond($repo, $cachedPayload, !$cachedFresh, ['fetch_status' => $status]);
    }

    // No cache and no successful fetch — surface a meaningful error.
    $errMsg = match (true) {
        $status === 0   => '無法連線 GitHub（network error 或 LiteSpeed 無 outbound）',
        $status === 403 => 'GitHub API rate limit（60 req/hr），請約一小時後再試',
        $status >= 500  => "GitHub upstream error（HTTP {$status}），請稍後再試",
        default         => "GitHub 回應 HTTP {$status}",
    };
    envelope_ok([
        'current_version' => STOCK_HOLD_VERSION,
        'latest_version' => null,
        'has_update' => false,
        'status' => 'error',
        'message' => $errMsg,
        'repo' => $repo,
        'stale' => false,
        'checked_at' => gmdate('c'),
    ]);
}
