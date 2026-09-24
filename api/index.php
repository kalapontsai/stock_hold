<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

security_headers();

set_exception_handler(static function (Throwable $e): never {
    error_log(json_encode(['event' => 'stock_hold_api_error', 'type' => get_class($e), 'message' => $e->getMessage()]));
    envelope_error('INTERNAL_ERROR', 'Internal server error.', 500);
});

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$marker = strpos($uri, '/api/v1');
$path = $marker === false ? '/' : substr($uri, $marker + strlen('/api/v1'));
$path = '/' . trim($path, '/');
$path = $path === '//' ? '/' : $path;

$pdo = db();

if ($method === 'GET' && $path === '/health') {
    envelope_ok(['service' => 'stock_hold', 'version' => STOCK_HOLD_VERSION]);
}
if ($method === 'GET' && $path === '/auth/session') {
    $user = current_user($pdo);
    envelope_ok(['csrf_token' => csrf_token(), 'authenticated' => $user !== null, 'user' => $user]);
}

if ($method === 'POST' && $path === '/auth/register') {
    require_csrf_token();
    if (!public_registration_enabled($pdo)) {
        envelope_error('REGISTRATION_DISABLED', 'Public registration is disabled.', 403);
    }
    require_fields($input = body_json(), ['username', 'email', 'password']);
    $username = trim((string)$input['username']);
    $email = strtolower(trim((string)$input['email']));
    $password = (string)$input['password'];
    if (!preg_match('/^[A-Za-z0-9_]{3,32}$/', $username)) {
        envelope_error('VALIDATION_ERROR', 'Username must contain 3-32 letters, numbers, or underscores.', 422);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
        envelope_error('VALIDATION_ERROR', 'Email format is invalid.', 422);
    }
    if (strlen($password) < 4 || !preg_match('/[A-Z]/', $password) || !preg_match('/[a-z]/', $password) || !preg_match('/[0-9]/', $password)) {
        envelope_error('VALIDATION_ERROR', 'Password must be at least 4 characters and include upper, lower, and numeric characters.', 422);
    }
    $now = now_sql();
    try {
        $pdo->beginTransaction();
        $stmt = $pdo->prepare('INSERT INTO users(username,email,password_hash,created_at,updated_at) VALUES(?,?,?,?,?)');
        $stmt->execute([$username, $email, password_hash($password, PASSWORD_DEFAULT), $now, $now]);
        $userId = (int)$pdo->lastInsertId();
        foreach (['accounts','securities','transactions','positions','prices','dividends','fx_rates','cash_balances'] as $table) {
            $pdo->exec("UPDATE {$table} SET user_id = {$userId} WHERE user_id IS NULL");
        }
        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if (str_contains($e->getMessage(), 'UNIQUE')) envelope_error('CONFLICT', 'Username or email already exists.', 409);
        throw $e;
    }
    start_session();
    session_regenerate_id(true);
    $_SESSION['user_id'] = $userId;
    $get = $pdo->prepare('SELECT id,username,email,created_at,updated_at FROM users WHERE id=?');
    $get->execute([$userId]);
    envelope_ok($get->fetch(), 201);
}

if ($method === 'POST' && $path === '/auth/login') {
    require_csrf_token();
    $input = body_json();
    require_fields($input, ['username', 'password']);
    $identity = trim((string)$input['username']);
    $ipKey = rate_limit_key('ip', client_ip());
    $identityKey = rate_limit_key('account', $identity);
    if (is_rate_limited($pdo, $ipKey) || is_rate_limited($pdo, $identityKey)) {
        envelope_error('RATE_LIMITED', 'Too many login attempts. Try again later.', 429);
    }
    $stmt = $pdo->prepare('SELECT * FROM users WHERE username=? OR email=? LIMIT 1');
    $stmt->execute([$identity, strtolower($identity)]);
    $user = $stmt->fetch();
    $locked = $user && $user['locked_until'] && strtotime($user['locked_until']) > time();
    if (!$user || $locked || !password_verify((string)$input['password'], (string)$user['password_hash'])) {
        record_failed_login($pdo, $ipKey);
        record_failed_login($pdo, $identityKey);
        if ($user) {
            $attempts = (int)$user['failed_login_attempts'] + 1;
            $until = $attempts >= 5 ? gmdate('Y-m-d H:i:s', time() + 900) : null;
            $update = $pdo->prepare('UPDATE users SET failed_login_attempts=?,locked_until=?,updated_at=? WHERE id=?');
            $update->execute([$attempts, $until, now_sql(), $user['id']]);
        }
        envelope_error('INVALID_CREDENTIALS', 'Username or password is incorrect.', 401);
    }
    $pdo->prepare('UPDATE users SET failed_login_attempts=0,locked_until=NULL,updated_at=? WHERE id=?')->execute([now_sql(), $user['id']]);
    clear_login_limits($pdo, $ipKey);
    clear_login_limits($pdo, $identityKey);
    start_session();
    session_regenerate_id(true);
    $_SESSION['user_id'] = (int)$user['id'];
    envelope_ok(['id' => (int)$user['id'], 'username' => $user['username'], 'email' => $user['email']]);
}

if ($method === 'POST' && $path === '/auth/logout') {
    require_csrf_token();
    start_session();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'] ?? '', (bool)$params['secure'], (bool)$params['httponly']);
    }
    session_destroy();
    envelope_ok(['logged_out' => true]);
}

if ($method === 'GET' && $path === '/auth/me') {
    envelope_ok(require_authenticated_user($pdo));
}

if ($method === 'POST' && $path === '/auth/profile') {
    $currentUser = require_write_access($pdo);
    $input = body_json();
    require_fields($input, ['username', 'email']);

    $username = trim((string)$input['username']);
    $email = strtolower(trim((string)$input['email']));
    if (!preg_match('/^[A-Za-z0-9_]{3,32}$/', $username)) {
        envelope_error('VALIDATION_ERROR', 'Username must contain 3-32 letters, numbers, or underscores.', 422);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
        envelope_error('VALIDATION_ERROR', 'Email format is invalid.', 422);
    }

    $newPassword = (string)($input['new_password'] ?? '');
    $passwordHash = null;
    if ($newPassword !== '') {
        $currentPassword = (string)($input['current_password'] ?? '');
        $hashStmt = $pdo->prepare('SELECT password_hash FROM users WHERE id=?');
        $hashStmt->execute([$currentUser['id']]);
        $storedHash = (string)$hashStmt->fetchColumn();
        if (!password_verify($currentPassword, $storedHash)) {
            envelope_error('INVALID_PASSWORD', 'Current password is incorrect.', 422);
        }
        if (strlen($newPassword) < 4 || !preg_match('/[A-Z]/', $newPassword) || !preg_match('/[a-z]/', $newPassword) || !preg_match('/[0-9]/', $newPassword)) {
            envelope_error('VALIDATION_ERROR', 'Password must be at least 4 characters and include upper, lower, and numeric characters.', 422);
        }
        $passwordHash = password_hash($newPassword, PASSWORD_DEFAULT);
    }

    try {
        $pdo->beginTransaction();
        if ($passwordHash === null) {
            $update = $pdo->prepare('UPDATE users SET username=?,email=?,updated_at=? WHERE id=?');
            $update->execute([$username, $email, now_sql(), $currentUser['id']]);
        } else {
            $update = $pdo->prepare('UPDATE users SET username=?,email=?,password_hash=?,failed_login_attempts=0,locked_until=NULL,updated_at=? WHERE id=?');
            $update->execute([$username, $email, $passwordHash, now_sql(), $currentUser['id']]);
        }
        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if (str_contains($e->getMessage(), 'UNIQUE')) {
            envelope_error('CONFLICT', 'Username or email already exists.', 409);
        }
        throw $e;
    }

    $get = $pdo->prepare('SELECT id,username,email,created_at,updated_at FROM users WHERE id=?');
    $get->execute([$currentUser['id']]);
    envelope_ok($get->fetch());
}

if ($method !== 'GET') {
    $currentUser = require_write_access($pdo);
} else {
    $currentUser = require_authenticated_user($pdo);
}
$userId = (int)$currentUser['id'];

$input = $method === 'GET' ? [] : ($input ?? body_json());

function row_account(array $row): array
{
    return $row;
}

function row_security(array $row): array
{
    $row['is_active'] = (bool)$row['is_active'];
    return $row;
}

function rebuild_position(PDO $pdo, int $userId, string $accountId, string $securityId): void
{
    $stmt = $pdo->prepare('SELECT type, qty, price, fees FROM transactions WHERE user_id = ? AND account_id = ? AND security_id = ? ORDER BY txn_date, created_at, id');
    $stmt->execute([$userId, $accountId, $securityId]);
    $qty = 0.0;
    $avg = 0.0;
    $realized = 0.0;
    foreach ($stmt as $txn) {
        $tQty = (float)($txn['qty'] ?? 0);
        $price = (float)($txn['price'] ?? 0);
        if ($txn['type'] === 'BUY') {
            $newQty = $qty + $tQty;
            if ($newQty > 0) {
                $avg = (($qty * $avg) + ($tQty * $price)) / $newQty;
            }
            $qty = $newQty;
        } elseif ($txn['type'] === 'RIGHTS') {
            $newQty = $qty + $tQty;
            if ($newQty > 0) {
                $avg = (($qty * $avg) + ($tQty * $price)) / $newQty;
            }
            $qty = $newQty;
        } elseif ($txn['type'] === 'SELL') {
            $realized += ($price - $avg) * $tQty - (float)($txn['fees'] ?? 0);
            $qty -= $tQty;
        }
    }
    $qty = max(0.0, $qty);
    $upsert = $pdo->prepare('INSERT INTO positions (account_id, security_id, user_id, qty, avg_cost, realized_pl, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, security_id) DO UPDATE SET user_id=excluded.user_id, qty=excluded.qty, avg_cost=excluded.avg_cost, realized_pl=excluded.realized_pl, updated_at=excluded.updated_at');
    $upsert->execute([$accountId, $securityId, $userId, $qty, $avg, $realized, now_sql()]);
}

function transaction_payload(PDO $pdo, int $userId, array $input, ?string $id = null): array
{
    require_fields($input, ['account_id', 'txn_date', 'type', 'currency']);
    $account = $pdo->prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?');
    $account->execute([$input['account_id'], $userId]);
    if (!$account->fetch()) {
        envelope_error('NOT_FOUND', 'Account does not exist.', 404);
    }
    if (!empty($input['security_id'])) {
        $security = $pdo->prepare('SELECT id FROM securities WHERE id=? AND user_id=?');
        $security->execute([$input['security_id'], $userId]);
        if (!$security->fetch()) {
            envelope_error('NOT_FOUND', 'Security does not exist.', 404);
        }
    }
    $type = strtoupper((string)$input['type']);
    $allowed = ['BUY','SELL','DIVIDEND','DEPOSIT','WITHDRAW','TRANSFER_IN','TRANSFER_OUT','FEE','SPLIT','MERGER','RIGHTS'];
    if (!in_array($type, $allowed, true)) {
        envelope_error('VALIDATION_ERROR', 'Transaction type is invalid.', 422);
    }
    $qty = $input['qty'] ?? null;
    $price = $input['price'] ?? null;
    $fees = (float)decimal($input['fees'] ?? '0');
    $gross = ((float)($qty ?? 0)) * ((float)($price ?? 0));
    $net = $gross + $fees;
    $negative = in_array($type, ['BUY','WITHDRAW','FEE','TRANSFER_OUT','RIGHTS'], true);
    $amount = array_key_exists('amount', $input) && $input['amount'] !== null && $input['amount'] !== ''
        ? (float)decimal($input['amount'])
        : ($negative ? -1 : 1) * $net;
    if (in_array($type, ['BUY','WITHDRAW','FEE','TRANSFER_OUT','RIGHTS'], true)) {
        $amount = -abs($amount);
    } elseif (in_array($type, ['SELL','DEPOSIT','DIVIDEND','TRANSFER_IN'], true)) {
        $amount = abs($amount);
    }
    return [
        'id' => $id ?: uuid(),
        'account_id' => (string)$input['account_id'],
        'security_id' => $input['security_id'] ?? null,
        'txn_date' => (string)$input['txn_date'],
        'type' => $type,
        'qty' => $qty === null ? null : decimal($qty),
        'price' => $price === null ? null : decimal($price),
        'fees' => (string)$fees,
        'currency' => strtoupper((string)$input['currency']),
        'fx_rate' => decimal($input['fx_rate'] ?? '1', '1'),
        'amount' => (string)$amount,
        'note' => $input['note'] ?? null,
        'user_id' => $userId,
        'updated_at' => now_sql(),
    ];
}

function app_setting(PDO $pdo, string $key, string $default = ''): string
{
    $stmt = $pdo->prepare('SELECT value FROM app_settings WHERE key=?');
    $stmt->execute([$key]);
    $value = $stmt->fetchColumn();
    return $value === false ? $default : (string)$value;
}

function save_app_setting(PDO $pdo, string $key, string $value): void
{
    $stmt = $pdo->prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at');
    $stmt->execute([$key, $value, now_sql()]);
}

function persist_prices(PDO $pdo, array $items): array
{
    $upsert = $pdo->prepare('INSERT INTO prices (id,security_id,date,open,high,low,close,volume,currency,created_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(security_id,date) DO UPDATE SET user_id=excluded.user_id,open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume,currency=excluded.currency,created_at=excluded.created_at');
    $updated = 0; $failed = [];
    foreach ($items as $item) {
        if (!is_array($item) || empty($item['security_id']) || empty($item['date']) || !isset($item['close'])) {
            $failed[] = ['item' => $item, 'reason' => 'security_id, date and close are required'];
            continue;
        }
        $close = decimal($item['close']);
        $open = decimal($item['open'] ?? $close);
        $high = decimal($item['high'] ?? $close);
        $low = decimal($item['low'] ?? $close);
        $upsert->execute([uuid(), $item['security_id'], $item['date'], $open, $high, $low, $close, decimal($item['volume'] ?? '0'), strtoupper((string)($item['currency'] ?? 'TWD')), now_sql(), (int)($item['user_id'] ?? 0)]);
        $updated++;
    }
    return ['updated' => $updated, 'failed' => $failed];
}

function fetch_twse_mis_quotes(PDO $pdo, array $securities): array
{
    if (!function_exists('curl_init')) {
        envelope_error('DEPENDENCY_MISSING', 'PHP cURL extension is required for quote updates.', 500);
    }
    $parts = [];
    foreach ($securities as $security) {
        $market = in_array(strtoupper((string)$security['exchange']), ['OTC', 'TPEx'], true) ? 'otc' : 'tse';
        $parts[] = $market . '_' . rawurlencode((string)$security['symbol']) . '.tw';
    }
    if (!$parts) return ['updated' => 0, 'failed' => []];
    $url = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' . implode('%7C', $parts);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: stock_hold/2.0'],
    ]);
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    if ($raw === false || $status < 200 || $status >= 300) {
        envelope_error('QUOTE_SOURCE_ERROR', 'Unable to fetch TWSE MIS quotes.', 502, $error ?: ('HTTP ' . $status));
    }
    $payload = json_decode($raw, true);
    if (!is_array($payload) || !is_array($payload['msgArray'] ?? null)) {
        envelope_error('QUOTE_SOURCE_ERROR', 'TWSE MIS returned an invalid response.', 502);
    }
    $bySymbol = [];
    foreach ($securities as $security) $bySymbol[(string)$security['symbol']] = $security;
    $items = []; $failed = [];
    foreach ($payload['msgArray'] as $quote) {
        $symbol = (string)($quote['c'] ?? '');
        $security = $bySymbol[$symbol] ?? null;
        $close = $quote['z'] ?? $quote['pz'] ?? null;
        if (!$security || $close === null || $close === '-' || !is_numeric($close)) {
            if ($security) $failed[] = ['symbol' => $symbol, 'reason' => 'No valid latest price'];
            continue;
        }
        $date = preg_replace('/[^0-9]/', '', (string)($quote['d'] ?? $quote['^'] ?? gmdate('Ymd')));
        $items[] = [
            'security_id' => $security['id'], 'date' => $date,
            'open' => is_numeric($quote['o'] ?? null) ? $quote['o'] : $close,
            'high' => is_numeric($quote['h'] ?? null) ? $quote['h'] : $close,
            'low' => is_numeric($quote['l'] ?? null) ? $quote['l'] : $close,
            'close' => $close, 'volume' => is_numeric($quote['v'] ?? null) ? $quote['v'] : '0',
            'currency' => $security['currency'], 'user_id' => (int)$security['user_id'],
        ];
    }
    return array_merge(persist_prices($pdo, $items), ['failed' => array_merge($failed, [])]);
}

if ($method === 'GET' && $path === '/accounts') {
    $stmt = $pdo->prepare('SELECT id,type,name,currency,broker,account_no,status,created_at,updated_at FROM accounts WHERE user_id=? ORDER BY type,name');
    $stmt->execute([$userId]);
    envelope_ok(list_data($stmt->fetchAll()));
}
if ($method === 'POST' && $path === '/accounts/create') {
    require_fields($input, ['type', 'name', 'currency']);
    $row = [uuid(), strtoupper((string)$input['type']), trim((string)$input['name']), strtoupper((string)$input['currency']), $input['broker'] ?? null, $input['account_no'] ?? null, 'ACTIVE', now_sql(), now_sql(), $userId];
    $stmt = $pdo->prepare('INSERT INTO accounts (id,type,name,currency,broker,account_no,status,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?)');
    $stmt->execute($row);
    $get = $pdo->prepare('SELECT id,type,name,currency,broker,account_no,status,created_at,updated_at FROM accounts WHERE id=? AND user_id=?');
    $get->execute([$row[0], $userId]);
    envelope_ok($get->fetch(), 201);
}
if ($method === 'POST' && $path === '/accounts/update') {
    require_fields($input, ['id', 'name', 'currency']);
    $stmt = $pdo->prepare('UPDATE accounts SET type=?,name=?,currency=?,broker=?,account_no=?,updated_at=? WHERE id=? AND user_id=?');
    $stmt->execute([strtoupper((string)($input['type'] ?? 'BANK')), trim((string)$input['name']), strtoupper((string)$input['currency']), $input['broker'] ?? null, $input['account_no'] ?? null, now_sql(), $input['id'], $userId]);
    if ($stmt->rowCount() === 0) envelope_error('NOT_FOUND', 'Account does not exist.', 404);
    $get = $pdo->prepare('SELECT id,type,name,currency,broker,account_no,status,created_at,updated_at FROM accounts WHERE id=? AND user_id=?');
    $get->execute([$input['id'], $userId]);
    envelope_ok($get->fetch());
}
if ($method === 'POST' && $path === '/accounts/disable') {
    require_fields($input, ['id']);
    $stmt = $pdo->prepare("UPDATE accounts SET status='INACTIVE',updated_at=? WHERE id=? AND user_id=?");
    $stmt->execute([now_sql(), $input['id'], $userId]);
    envelope_ok(['id' => $input['id'], 'deleted' => $stmt->rowCount() > 0, 'status' => 'INACTIVE']);
}

if ($method === 'GET' && $path === '/securities') {
    $stmt = $pdo->prepare('SELECT id,symbol,exchange,currency,name,type,sector,is_active,created_at,updated_at FROM securities WHERE is_active=1 AND user_id=? ORDER BY symbol');
    $stmt->execute([$userId]);
    envelope_ok(list_data(array_map('row_security', $stmt->fetchAll())));
}
if ($method === 'POST' && $path === '/securities/create') {
    require_fields($input, ['symbol', 'name', 'type']);
    $row = [uuid(), strtoupper(trim((string)$input['symbol'])), strtoupper((string)($input['exchange'] ?? 'TW')), strtoupper((string)($input['currency'] ?? 'TWD')), trim((string)$input['name']), strtoupper((string)$input['type']), $input['sector'] ?? null, 1, now_sql(), now_sql(), $userId];
    try {
        $stmt = $pdo->prepare('INSERT INTO securities (id,symbol,exchange,currency,name,type,sector,is_active,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
        $stmt->execute($row);
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'UNIQUE')) envelope_error('CONFLICT', 'Symbol already exists.', 409);
        throw $e;
    }
    $get = $pdo->prepare('SELECT * FROM securities WHERE id=? AND user_id=?');
    $get->execute([$row[0], $userId]);
    envelope_ok(row_security($get->fetch()), 201);
}
if ($method === 'POST' && $path === '/securities/update') {
    require_fields($input, ['id', 'name', 'type']);
    $stmt = $pdo->prepare('UPDATE securities SET exchange=?,currency=?,name=?,type=?,sector=?,updated_at=? WHERE id=? AND user_id=?');
    $stmt->execute([strtoupper((string)($input['exchange'] ?? 'TW')), strtoupper((string)($input['currency'] ?? 'TWD')), trim((string)$input['name']), strtoupper((string)$input['type']), $input['sector'] ?? null, now_sql(), $input['id'], $userId]);
    if ($stmt->rowCount() === 0) envelope_error('NOT_FOUND', 'Security does not exist.', 404);
    $get = $pdo->prepare('SELECT * FROM securities WHERE id=? AND user_id=?');
    $get->execute([$input['id'], $userId]);
    envelope_ok(row_security($get->fetch()));
}
if ($method === 'POST' && $path === '/securities/disable') {
    require_fields($input, ['id']);
    $stmt = $pdo->prepare('UPDATE securities SET is_active=0,updated_at=? WHERE id=? AND user_id=?');
    $stmt->execute([now_sql(), $input['id'], $userId]);
    envelope_ok(['id' => $input['id'], 'deleted' => $stmt->rowCount() > 0, 'is_active' => false]);
}

if ($method === 'GET' && $path === '/transactions') {
    $where = [];
    $args = [];
    foreach (['account_id','security_id','type'] as $field) {
        if (isset($_GET[$field]) && $_GET[$field] !== '') {
            $where[] = "t.{$field} = ?";
            $args[] = $_GET[$field];
        }
    }
    if (!empty($_GET['from'])) { $where[] = 't.txn_date >= ?'; $args[] = $_GET['from']; }
    if (!empty($_GET['to'])) { $where[] = 't.txn_date <= ?'; $args[] = $_GET['to']; }
    $where[] = 't.user_id = ?';
    $args[] = $userId;
    $sql = 'SELECT t.*,a.name AS account_name,s.symbol,s.name AS security_name FROM transactions t JOIN accounts a ON a.id=t.account_id AND a.user_id=t.user_id LEFT JOIN securities s ON s.id=t.security_id AND s.user_id=t.user_id';
    if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
    $sql .= ' ORDER BY t.txn_date DESC,t.created_at DESC';
    $stmt = $pdo->prepare($sql); $stmt->execute($args);
    envelope_ok(list_data($stmt->fetchAll()));
}
if ($method === 'POST' && $path === '/transactions/create') {
    $row = transaction_payload($pdo, $userId, $input);
    $pdo->beginTransaction();
    $stmt = $pdo->prepare('INSERT INTO transactions (id,account_id,security_id,txn_date,type,qty,price,fees,currency,fx_rate,amount,note,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $stmt->execute([$row['id'],$row['account_id'],$row['security_id'],$row['txn_date'],$row['type'],$row['qty'],$row['price'],$row['fees'],$row['currency'],$row['fx_rate'],$row['amount'],$row['note'],now_sql(),$row['updated_at'],$userId]);
    if ($row['security_id']) rebuild_position($pdo, $userId, $row['account_id'], $row['security_id']);
    $pdo->commit();
    envelope_ok($row, 201);
}
if ($method === 'POST' && $path === '/transactions/update') {
    require_fields($input, ['id']);
    $old = $pdo->prepare('SELECT account_id,security_id FROM transactions WHERE id=? AND user_id=?'); $old->execute([$input['id'], $userId]); $previous = $old->fetch();
    if (!$previous) envelope_error('NOT_FOUND', 'Transaction does not exist.', 404);
    $row = transaction_payload($pdo, $userId, $input, (string)$input['id']);
    $stmt = $pdo->prepare('UPDATE transactions SET account_id=?,security_id=?,txn_date=?,type=?,qty=?,price=?,fees=?,currency=?,fx_rate=?,amount=?,note=?,updated_at=? WHERE id=? AND user_id=?');
    $stmt->execute([$row['account_id'],$row['security_id'],$row['txn_date'],$row['type'],$row['qty'],$row['price'],$row['fees'],$row['currency'],$row['fx_rate'],$row['amount'],$row['note'],$row['updated_at'],$row['id'],$userId]);
    if ($previous['security_id']) rebuild_position($pdo, $userId, $previous['account_id'], $previous['security_id']);
    if ($row['security_id']) rebuild_position($pdo, $userId, $row['account_id'], $row['security_id']);
    envelope_ok($row);
}
if ($method === 'POST' && $path === '/transactions/reverse') {
    require_fields($input, ['id']);
    $stmt = $pdo->prepare('SELECT * FROM transactions WHERE id=? AND user_id=?'); $stmt->execute([$input['id'], $userId]); $old = $stmt->fetch();
    if (!$old) envelope_error('NOT_FOUND', 'Transaction does not exist.', 404);
    $pdo->beginTransaction();
    $insert = $pdo->prepare('INSERT INTO transactions (id,account_id,security_id,txn_date,type,qty,price,fees,currency,fx_rate,amount,note,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $reverseType = $old['type'] === 'BUY' ? 'SELL' : ($old['type'] === 'SELL' ? 'BUY' : 'FEE');
    $insert->execute([uuid(),$old['account_id'],$old['security_id'],gmdate('Y-m-d'),$reverseType,$old['qty'],$old['price'],$old['fees'],$old['currency'],$old['fx_rate'],-$old['amount'],'Reversal of '.$old['id'],now_sql(),now_sql(),$userId]);
    if ($old['security_id']) rebuild_position($pdo, $userId, $old['account_id'], $old['security_id']);
    $pdo->commit();
    envelope_ok(['id' => $old['id'], 'reversed' => true]);
}
if ($method === 'POST' && $path === '/transactions/delete') {
    require_fields($input, ['id']);
    $stmt = $pdo->prepare('SELECT * FROM transactions WHERE id=? AND user_id=?'); $stmt->execute([$input['id'], $userId]); $old = $stmt->fetch();
    if (!$old) envelope_error('NOT_FOUND', 'Transaction does not exist.', 404);
    $pdo->beginTransaction();
    $del = $pdo->prepare('DELETE FROM transactions WHERE id=? AND user_id=?');
    $del->execute([$input['id'], $userId]);
    if ($old['security_id']) rebuild_position($pdo, $userId, $old['account_id'], $old['security_id']);
    $pdo->commit();
    envelope_ok(['id' => $old['id'], 'deleted' => true]);
}
if ($method === 'POST' && $path === '/transactions/batch-delete') {
    $ids = $input['ids'] ?? null;
    if (!is_array($ids) || count($ids) === 0) {
        envelope_error('VALIDATION_ERROR', 'ids must be a non-empty array.', 422);
    }
    $ids = array_values(array_unique(array_map('strval', $ids)));
    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $stmt = $pdo->prepare("SELECT id, account_id, security_id FROM transactions WHERE user_id=? AND id IN ($placeholders)");
    $stmt->execute(array_merge([$userId], $ids));
    $rows = $stmt->fetchAll();
    if (count($rows) !== count($ids)) {
        envelope_error('NOT_FOUND', 'One or more transactions do not exist.', 404);
    }
    $pdo->beginTransaction();
    $del = $pdo->prepare("DELETE FROM transactions WHERE user_id=? AND id IN ($placeholders)");
    $del->execute(array_merge([$userId], $ids));
    $rebuilt = [];
    foreach ($rows as $row) {
        if (!$row['security_id']) continue;
        $key = $row['account_id'] . "\0" . $row['security_id'];
        if (isset($rebuilt[$key])) continue;
        rebuild_position($pdo, $userId, $row['account_id'], $row['security_id']);
        $rebuilt[$key] = true;
    }
    $pdo->commit();
    envelope_ok(['ids' => $ids, 'deleted' => count($ids)]);
}

if ($method === 'GET' && $path === '/holdings') {
    $sql = 'SELECT p.*,s.symbol,s.name,s.currency,a.name AS account_name,COALESCE((SELECT close FROM prices pr WHERE pr.security_id=p.security_id AND pr.user_id=p.user_id ORDER BY pr.date DESC LIMIT 1),0) AS current_price FROM positions p JOIN securities s ON s.id=p.security_id AND s.user_id=p.user_id JOIN accounts a ON a.id=p.account_id AND a.user_id=p.user_id WHERE p.qty > 0 AND p.user_id=? ORDER BY s.symbol,a.name';
    $stmt = $pdo->prepare($sql); $stmt->execute([$userId]);
    envelope_ok(list_data($stmt->fetchAll()));
}
if ($method === 'GET' && $path === '/dividends') {
    $sql = 'SELECT d.id,d.ex_date,d.pay_date,d.amount_per_share AS per_share,d.currency,s.symbol,s.name FROM dividends d JOIN securities s ON s.id=d.security_id AND s.user_id=d.user_id WHERE d.user_id=? ORDER BY d.pay_date DESC';
    $stmt = $pdo->prepare($sql); $stmt->execute([$userId]); $rows = $stmt->fetchAll();
    foreach ($rows as &$row) { $row['qty'] = '0'; $row['amount_twd'] = '0'; }
    unset($row);
    envelope_ok(list_data($rows));
}
if ($method === 'GET' && $path === '/dashboard/summary') {
    $count = static function (PDO $pdo, string $sql, int $userId): int { $stmt = $pdo->prepare($sql); $stmt->execute([$userId]); return (int)$stmt->fetchColumn(); };
    $accounts = $count($pdo, 'SELECT COUNT(*) FROM accounts WHERE status="ACTIVE" AND user_id=?', $userId);
    $transactions = $count($pdo, 'SELECT COUNT(*) FROM transactions WHERE user_id=?', $userId);
    $stmt = $pdo->prepare('SELECT COALESCE(SUM(p.qty * COALESCE((SELECT close FROM prices pr WHERE pr.security_id=p.security_id AND pr.user_id=p.user_id ORDER BY pr.date DESC LIMIT 1),0)),0) FROM positions p WHERE p.user_id=?'); $stmt->execute([$userId]); $market = (float)$stmt->fetchColumn();
    $stmt = $pdo->prepare('SELECT COALESCE(SUM(amount),0) FROM transactions WHERE security_id IS NULL AND user_id=?'); $stmt->execute([$userId]); $cash = (float)$stmt->fetchColumn();
    $positive = $count($pdo, 'SELECT COUNT(*) FROM positions p WHERE p.qty > 0 AND p.user_id=? AND p.avg_cost <= COALESCE((SELECT close FROM prices pr WHERE pr.security_id=p.security_id AND pr.user_id=p.user_id ORDER BY pr.date DESC LIMIT 1), p.avg_cost)', $userId);
    $holdings = $count($pdo, 'SELECT COUNT(*) FROM positions WHERE qty > 0 AND user_id=?', $userId);
    $total = $market + $cash;
    envelope_ok([
        'total_assets' => (string)$total,
        'total_assets_prev' => (string)$total,
        'market_value' => (string)$market,
        'cash_balance' => (string)$cash,
        'today_pnl' => '0', 'today_pnl_pct' => '0',
        'mtd_pnl' => '0', 'mtd_pnl_pct' => '0',
        'unrealized_pnl' => '0', 'unrealized_pnl_pct' => '0',
        'realized_mtd' => '0', 'dividend_mtd' => '0',
        'holdings_count' => $holdings, 'holdings_positive' => $positive,
        'usage_pct' => 0, 'account_count' => $accounts, 'transaction_count' => $transactions,
        'as_of' => gmdate('c'),
    ]);
}
if ($method === 'GET' && $path === '/dashboard/allocation') {
    $stmt = $pdo->prepare('SELECT s.exchange AS label, SUM(p.qty * COALESCE((SELECT close FROM prices pr WHERE pr.security_id=p.security_id AND pr.user_id=p.user_id ORDER BY pr.date DESC LIMIT 1),0)) AS value FROM positions p JOIN securities s ON s.id=p.security_id AND s.user_id=p.user_id WHERE p.qty > 0 AND p.user_id=? GROUP BY s.exchange ORDER BY value DESC'); $stmt->execute([$userId]); $rows = $stmt->fetchAll();
    $stmt = $pdo->prepare('SELECT COALESCE(SUM(amount),0) FROM transactions WHERE security_id IS NULL AND user_id=?'); $stmt->execute([$userId]); $cash = (float)$stmt->fetchColumn();
    $allocation = array_map(static fn(array $row): array => ['label' => $row['label'], 'value' => (float)$row['value'], 'color' => null], $rows);
    if ($cash > 0) $allocation[] = ['label' => '現金', 'value' => $cash, 'color' => null];
    envelope_ok($allocation);
}
if ($method === 'GET' && $path === '/dashboard/recent') {
    $stmt = $pdo->prepare('SELECT t.*,s.symbol FROM transactions t LEFT JOIN securities s ON s.id=t.security_id AND s.user_id=t.user_id WHERE t.user_id=? ORDER BY t.txn_date DESC,t.created_at DESC LIMIT 5'); $stmt->execute([$userId]); $rows = $stmt->fetchAll();
    foreach ($rows as &$row) $row['amount'] = ((float)$row['amount'] >= 0 ? '+' : '') . (string)$row['amount'];
    unset($row);
    envelope_ok($rows);
}
if ($method === 'GET' && $path === '/dashboard/monthly-pnl') {
    $labels = [];
    $cursor = new DateTimeImmutable('first day of -11 months');
    for ($i = 0; $i < 12; $i++) { $labels[] = $cursor->format('n') . '月'; $cursor = $cursor->modify('+1 month'); }
    envelope_ok(['labels' => $labels, 'realized' => array_fill(0, 12, '0'), 'unrealized' => array_fill(0, 12, '0')]);
}
if ($method === 'GET' && preg_match('#^/reports/(realized|unrealized|dividends|tax-estimate)$#', $path, $match)) {
    if ($match[1] === 'dividends') {
        $stmt = $pdo->prepare('SELECT d.id,d.ex_date,d.pay_date,d.amount_per_share AS per_share,d.currency,s.symbol,s.name FROM dividends d JOIN securities s ON s.id=d.security_id AND s.user_id=d.user_id WHERE d.user_id=? ORDER BY d.pay_date DESC'); $stmt->execute([$userId]); $rows = $stmt->fetchAll();
        foreach ($rows as &$row) { $row['qty'] = '0'; $row['amount_twd'] = '0'; }
        unset($row);
        envelope_ok($rows);
    } elseif ($match[1] === 'tax-estimate') {
        envelope_ok(['year' => (int)gmdate('Y'), 'tw_dividend_income' => '0', 'tw_dividend_taxable' => '0', 'us_withholding_usd' => '0', 'us_withholding_twd' => '0', 'realized_gain' => '0', 'exemption_twd' => '100000', 'taxable_gain' => '0', 'notes' => [], 'disclaimer' => '僅供估算，非正式稅務申報結果。']);
    } elseif ($match[1] === 'realized') {
        envelope_ok(['summary' => ['total_realized' => '0', 'winning_rate_pct' => '0', 'wins' => 0, 'total_trades' => 0, 'avg_holding_days' => 0, 'max_single_gain' => '0', 'total_dividend_twd' => '0', 'total_dividend_usd' => '0'], 'monthly' => ['labels' => [], 'values' => []], 'trades' => []]);
    } else {
        envelope_ok([]);
    }
}
if ($method === 'GET' && $path === '/settings/quotes') {
    $stmt = $pdo->prepare('SELECT MAX(created_at) FROM prices WHERE user_id=?'); $stmt->execute([$userId]); $last = $stmt->fetchColumn();
    envelope_ok([
        'provider' => app_setting($pdo, 'quotes.provider', 'twse_mis'),
        'enabled' => app_setting($pdo, 'quotes.enabled', '1') === '1',
        'interval_minutes' => (int)app_setting($pdo, 'quotes.interval_minutes', '15'),
        'last_updated' => $last ?: null,
    ]);
}
if ($method === 'POST' && $path === '/settings/quotes') {
    $provider = (string)($input['provider'] ?? 'twse_mis');
    if (!in_array($provider, ['twse_mis', 'manual'], true)) envelope_error('VALIDATION_ERROR', 'Unsupported quote provider.', 422);
    $interval = (int)($input['interval_minutes'] ?? 15);
    if ($interval < 1 || $interval > 1440) envelope_error('VALIDATION_ERROR', 'Interval must be between 1 and 1440 minutes.', 422);
    save_app_setting($pdo, 'quotes.provider', $provider);
    save_app_setting($pdo, 'quotes.enabled', !empty($input['enabled']) ? '1' : '0');
    save_app_setting($pdo, 'quotes.interval_minutes', (string)$interval);
    envelope_ok(['provider' => $provider, 'enabled' => !empty($input['enabled']), 'interval_minutes' => $interval]);
}
if ($method === 'GET' && $path === '/skills') envelope_ok([]);
if ($method === 'POST' && preg_match('#^/skills/[^/]+/(run|toggle)$#', $path)) envelope_error('NOT_IMPLEMENTED', 'Skill execution is not enabled in Apache-only runtime.', 501);
if ($method === 'GET' && ($path === '/prices/last-update' || $path === '/maintenance/last-price-update')) { $stmt = $pdo->prepare('SELECT MAX(created_at) FROM prices WHERE user_id=?'); $stmt->execute([$userId]); envelope_ok(['as_of' => $stmt->fetchColumn() ?: null]); }
if ($method === 'POST' && $path === '/maintenance/backup') {
    $backupDir = runtime_dir() . DIRECTORY_SEPARATOR . 'backup';
    if (!is_dir($backupDir)) mkdir($backupDir, 0770, true);
    $target = $backupDir . DIRECTORY_SEPARATOR . 'stock_hold_' . gmdate('Ymd_His') . '.sqlite';
    copy(runtime_dir() . DIRECTORY_SEPARATOR . 'stock_hold.sqlite', $target);
    envelope_ok(['backup_file' => basename($target)]);
}
if ($method === 'POST' && $path === '/maintenance/restore') {
    require_fields($input, ['backup_file', 'confirm']);
    if ($input['confirm'] !== true) envelope_error('VALIDATION_ERROR', 'Restore requires confirm=true.', 422);
    $name = basename((string)$input['backup_file']);
    if (!preg_match('/^stock_hold_[0-9]{8}_[0-9]{6}\.sqlite$/', $name)) envelope_error('VALIDATION_ERROR', 'Invalid backup file name.', 422);
    $source = runtime_dir() . DIRECTORY_SEPARATOR . 'backup' . DIRECTORY_SEPARATOR . $name;
    if (!is_file($source)) envelope_error('NOT_FOUND', 'Backup file does not exist.', 404);
    $current = runtime_dir() . DIRECTORY_SEPARATOR . 'stock_hold.sqlite';
    $safety = runtime_dir() . DIRECTORY_SEPARATOR . 'backup' . DIRECTORY_SEPARATOR . 'stock_hold_before_restore_' . gmdate('Ymd_His') . '.sqlite';
    if (!copy($current, $safety) || !copy($source, $current)) envelope_error('RESTORE_FAILED', 'Unable to restore database.', 500);
    envelope_ok(['restored_file' => $name, 'safety_backup' => basename($safety)]);
}
if ($method === 'POST' && $path === '/maintenance/reconcile') envelope_ok(['matched' => true, 'diff' => '0']);
if ($method === 'POST' && $path === '/prices/batch-update') {
    $hasManualItems = array_key_exists('prices', $input) || array_key_exists('items', $input);
    $items = $input['prices'] ?? $input['items'] ?? [];
    if ($hasManualItems && !is_array($items)) envelope_error('VALIDATION_ERROR', 'prices must be an array.', 422);
    if (!$hasManualItems || count($items) === 0) {
        if (app_setting($pdo, 'quotes.provider', 'twse_mis') === 'manual') envelope_error('QUOTE_PROVIDER_MANUAL', 'Quote provider is set to manual.', 422);
        $symbols = $input['symbols'] ?? [];
        $sql = 'SELECT id,symbol,exchange,currency,user_id FROM securities WHERE is_active=1 AND user_id=?';
        $params = [$userId];
        if (is_array($symbols) && count($symbols) > 0) {
            $placeholders = implode(',', array_fill(0, count($symbols), '?'));
            $sql .= " AND symbol IN ({$placeholders})";
            $params = array_values($symbols);
        }
        $stmt = $pdo->prepare($sql); $stmt->execute($params);
        envelope_ok(fetch_twse_mis_quotes($pdo, $stmt->fetchAll()));
    }
    foreach ($items as $item) {
        if (!is_array($item) || empty($item['security_id'])) {
            continue;
        }
        $security = $pdo->prepare('SELECT id FROM securities WHERE id=? AND user_id=?');
        $security->execute([$item['security_id'], $userId]);
        if (!$security->fetch()) {
            envelope_error('NOT_FOUND', 'Security does not exist.', 404);
        }
    }
    foreach ($items as &$item) { if (is_array($item)) $item['user_id'] = $userId; } unset($item);
    envelope_ok(persist_prices($pdo, $items));
}
if ($method === 'POST' && $path === '/fx/refresh') envelope_ok(['updated_pairs' => [], 'added' => 0]);
if ($method === 'GET' && ($path === '/schema' || preg_match('#^/schema/[^/]+$#', $path))) envelope_ok(['version' => STOCK_HOLD_VERSION, 'entities' => ['accounts','securities','transactions','positions','prices','dividends','fx_rates','cash_balances']]);

envelope_error('NOT_FOUND', 'Route not found.', 404);
