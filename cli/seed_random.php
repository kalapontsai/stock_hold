<?php
/**
 * Stock Hold — random-data seeder (CLI).
 *
 * Usage:
 *   php cli/seed_random.php                       # dry-run (default)
 *   php cli/seed_random.php --confirm             # actually wipe + seed
 *   php cli/seed_random.php --confirm --count=10 --from=2026-10-01 --to=2026-10-07
 *   php cli/seed_random.php --confirm --user=2
 *
 * Default behaviour: dry-run. Prints what WOULD be deleted / inserted and
 * the operator confirms with `--confirm`. Refuses to run if:
 *   - the target user has zero ACTIVE accounts
 *   - the target user has zero securities
 *   - no securities match the price band table (only TW symbols are
 *     banded; others get a 10-1000 fallback)
 *
 * Wipes: transactions, positions, prices, dividends (all scoped to user)
 * Keeps: accounts, securities, extension_api_keys, app_settings, users,
 *        schema_migrations, api_tokens, audit_log, *_rate_limits.
 *
 * Each BUY triggers a rebuild of (account_id, security_id) position so
 * /holdings returns rows immediately after --confirm.
 *
 * Notes:
 *   - rebuild_position() lives in api/index.php (not bootstrap). We
 *     inline a copy here because cli/ must not load the API front-
 *     controller (it would route requests). The inlined copy mirrors
 *     api/index.php:415-451; keep them in sync if either changes.
 *   - Price bands are Q4-2026 TW approximations; they pick a random
 *     price in the band so the seeder doesn't always produce the same
 *     numbers. Not financial advice — purely demo data.
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/bootstrap.php';

/* ---------- Argv parsing ---------- */
$opts = [
    'confirm' => false,
    'user'    => 1,
    'count'   => 5,
    'from'    => '2026-10-01',
    'to'      => '2026-10-07',
];
for ($i = 1; $i < $argc; $i++) {
    $arg = $argv[$i];
    if ($arg === '--confirm') { $opts['confirm'] = true; continue; }
    if ($arg === '--help' || $arg === '-h') { fwrite(STDOUT, seed_help()); exit(0); }
    if (str_starts_with($arg, '--user='))   { $opts['user']  = (int)substr($arg, 7); continue; }
    if (str_starts_with($arg, '--count='))  { $opts['count'] = max(1, (int)substr($arg, 8)); continue; }
    if (str_starts_with($arg, '--from='))   { $opts['from']  = substr($arg, 7); continue; }
    if (str_starts_with($arg, '--to='))     { $opts['to']    = substr($arg, 5); continue; }
    fwrite(STDERR, "Unknown arg: {$arg}\n");
    fwrite(STDOUT, seed_help());
    exit(2);
}
if (!$opts['confirm']) {
    fwrite(STDERR, "[DRY-RUN] pass --confirm to actually apply changes.\n\n");
}

$userId = $opts['user'];
$count  = $opts['count'];
$from   = $opts['from'];
$to     = $opts['to'];

// Date sanity: YYYY-MM-DD, from <= to
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) || $from > $to) {
    fwrite(STDERR, "Bad --from/--to (need YYYY-MM-DD, from <= to)\n");
    exit(2);
}

/* ---------- Load data ---------- */
$secRows = db()->prepare(
    "SELECT id, symbol, name, currency FROM securities WHERE user_id=? ORDER BY symbol"
);
$secRows->execute([$userId]);
$secRows = $secRows->fetchAll(PDO::FETCH_ASSOC);
$accRows = db()->prepare(
    "SELECT id, name, currency FROM accounts WHERE user_id=? AND status='ACTIVE' ORDER BY type, name"
);
$accRows->execute([$userId]);
$accRows = $accRows->fetchAll(PDO::FETCH_ASSOC);

if (count($secRows) < 1 || count($accRows) < 1) {
    fwrite(STDERR, sprintf(
        "Refusing: user_id=%d has %d securities / %d ACTIVE accounts. Need >=1 of each.\n",
        $userId, count($secRows), count($accRows)
    ));
    exit(1);
}

/* ---------- Price band per symbol ---------- */
$priceBand = [
    '0050'  => [62.0, 75.0],
    '0056'  => [52.0, 62.0],
    '00713' => [60.0, 72.0],
    '2002'  => [25.0, 32.0],
    '2330'  => [1050.0, 1300.0],
    '2881'  => [80.0, 100.0],
    '2885'  => [38.0, 48.0],
    '2891'  => [34.0, 44.0],
];
$qtyBand = [100, 5000];

/* ---------- rebuild_position inline (mirrors api/index.php:415-451) ---------- */
function rebuild_position_inline(PDO $pdo, int $userId, string $accountId, string $securityId): void
{
    $stmt = $pdo->prepare('SELECT type, qty, price, fees FROM transactions WHERE user_id = ? AND account_id = ? AND security_id = ? ORDER BY txn_date, created_at, id');
    $stmt->execute([$userId, $accountId, $securityId]);
    $qty = 0.0;
    $avg = 0.0;
    $realized = 0.0;
    foreach ($stmt as $txn) {
        $tQty = (float)($txn['qty'] ?? 0);
        $price = (float)($txn['price'] ?? 0);
        if ($txn['type'] === 'BUY' || $txn['type'] === 'RIGHTS') {
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

/* ---------- Plan the random buys (printed in both modes) ---------- */
function randFloat(float $min, float $max): float { return $min + (mt_rand() / mt_getrandmax()) * ($max - $min); }
function randInt(int $min, int $max): int { return mt_rand($min, $max); }
function randDateInRange(string $from, string $to): string {
    $a = strtotime($from); $b = strtotime($to);
    $t = $a + mt_rand(0, max(0, $b - $a));
    return gmdate('Y-m-d', $t);
}

$plan = [];
for ($i = 0; $i < $count; $i++) {
    $sec = $secRows[array_rand($secRows)];
    $symbol = $sec['symbol'];
    $band = $priceBand[$symbol] ?? [10.0, 1000.0];
    $price = round(randFloat($band[0], $band[1]), 2);
    $qty = randInt($qtyBand[0], $qtyBand[1]);
    $acc = $accRows[array_rand($accRows)];
    $date = randDateInRange($from, $to);
    $amount = round($qty * $price, 2);
    $plan[] = [
        'symbol' => $symbol, 'name' => $sec['name'],
        'qty' => $qty, 'price' => $price, 'amount' => -$amount,
        'account' => $acc['name'], 'date' => $date,
    ];
}

/* ---------- Pre-state (always reported) ---------- */
$pdo = $pdo;
$preDelete = [];
foreach (['transactions', 'positions', 'prices', 'dividends'] as $tbl) {
    $preDelete[$tbl] = (int)$pdo->prepare("SELECT COUNT(*) FROM {$tbl} WHERE user_id=?")
        ->execute([$userId]) ? 1 : 1;
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM {$tbl} WHERE user_id=?");
    $stmt->execute([$userId]);
    $preDelete[$tbl] = (int)$stmt->fetchColumn();
}

/* ---------- Apply or stop ---------- */
if (!$opts['confirm']) {
    fwrite(STDOUT, json_encode([
        'mode' => 'dry-run',
        'user_id' => $userId,
        'will_delete' => array_map(fn($n) => "DELETE FROM {$n} WHERE user_id={$userId}", ['transactions', 'positions', 'prices', 'dividends']),
        'pre_counts' => $preDelete,
        'will_insert' => $plan,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
    exit(0);
}

$pdo->beginTransaction();
$report = ['mode' => 'apply', 'user_id' => $userId, 'deleted' => [], 'inserted' => []];
try {
    foreach (['transactions', 'positions', 'prices', 'dividends'] as $tbl) {
        $stmt = $pdo->prepare("DELETE FROM {$tbl} WHERE user_id=?");
        $stmt->execute([$userId]);
        $report['deleted'][$tbl] = $stmt->rowCount();
    }
    foreach ($plan as $i => $row) {
        // Re-fetch accounts/securities by name + symbol to find their IDs
        // (the plan only printed display names; we resolve IDs here).
        $sec = null;
        foreach ($secRows as $s) {
            if ($s['symbol'] === $row['symbol']) { $sec = $s; break; }
        }
        $acc = null;
        foreach ($accRows as $a) {
            if ($a['name'] === $row['account']) { $acc = $a; break; }
        }
        $id = uuid();
        $now = now_sql();
        $ins = $pdo->prepare(
            'INSERT INTO transactions (id, account_id, security_id, txn_date, type, qty, price, fees, currency, fx_rate, amount, note, created_at, updated_at, user_id) ' .
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([
            $id, $acc['id'], $sec['id'], $row['date'], 'BUY',
            (string)$row['qty'], (string)$row['price'], '0',
            $sec['currency'], '1', (string)$row['amount'],
            "隨機虛擬資料 #$i @{$row['date']}", $now, $now, $userId,
        ]);
        rebuild_position_inline($pdo, $userId, $acc['id'], $sec['id']);
        $report['inserted'][] = ['txn_id' => $id] + $row;
    }
    // Post-state
    $post = [];
    foreach (['transactions', 'positions', 'prices', 'dividends'] as $tbl) {
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM {$tbl} WHERE user_id=?");
        $stmt->execute([$userId]);
        $post[$tbl] = (int)$stmt->fetchColumn();
    }
    $report['post_counts'] = $post;
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    fwrite(STDERR, "ERROR: " . get_class($e) . ': ' . $e->getMessage() . "\n");
    exit(1);
}

fwrite(STDOUT, json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");

function seed_help(): string {
    return <<<HELP
Usage: php cli/seed_random.php [options]

Options:
  --confirm                Apply changes (default: dry-run)
  --user=ID                Target user_id (default: 1)
  --count=N                Number of random BUY transactions (default: 5)
  --from=YYYY-MM-DD        Start of random date range (default: 2026-10-01)
  --to=YYYY-MM-DD          End of random date range   (default: 2026-10-07)
  -h, --help               Show this help

What it does (with --confirm):
  - DELETE FROM {transactions,positions,prices,dividends} WHERE user_id=ID
  - INSERT <count> random BUY transactions for the user
  - Rebuild positions so /holdings returns rows immediately

Refuses if user has zero ACTIVE accounts or zero securities.

Example:
  php cli/seed_random.php --user=1 --count=10 --from=2026-10-01 --to=2026-10-07 --confirm
HELP;
}