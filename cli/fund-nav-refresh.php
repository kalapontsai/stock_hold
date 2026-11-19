<?php
declare(strict_types=1);

/**
 * Stock_hold CLI — refresh fund NAV prints for every NAV-priced holding.
 *
 * Why a CLI job instead of a CGI endpoint or an ActiveX control:
 *
 *   * The NAV feed is reachable server-side over HTTPS. Nothing needs to
 *     run in the user's browser, so there is no reason to involve ActiveX
 *     (Windows-only, and this app is deployed on Linux/Apache).
 *   * A public CGI script under the web root would let anyone trigger
 *     outbound fetches on demand. A CLI job has no HTTP surface at all.
 *   * One CLI job serves every user and every fund, so the work per fund
 *     does not grow with the number of funds.
 *
 * Schedule it once a day after the issuer publishes the day's NAV (NAV
 * for day D is published in the evening of day D). Example crontab entry:
 *
 *   30 20 * * 1-5  php /path/to/stock_hold/cli/fund-nav-refresh.php
 *
 * Usage:
 *   php cli/fund-nav-refresh.php [--user=ID] [--dry-run]
 *
 * Output (stdout):
 *   Users processed: N
 *   Securities priced: N
 *   Failed: N
 *
 * Exit codes:
 *   0 — success (including "nothing to do")
 *   1 — the NAV source could not be reached at all
 */

require_once dirname(__DIR__) . '/api/bootstrap.php';
require_once dirname(__DIR__) . '/api/_fund_nav.php';

$pdo = db();

$userId = 0;
$dryRun = false;
foreach (array_slice($argv, 1) as $arg) {
    if (str_starts_with($arg, '--user=')) {
        $userId = (int)substr($arg, 7);
    } elseif ($arg === '--dry-run') {
        $dryRun = true;
    }
}

$sql = 'SELECT id,user_id,symbol,exchange,currency,nav_source,nav_code'
    . ' FROM securities WHERE is_active=1 AND nav_source IS NOT NULL AND nav_code IS NOT NULL';
$params = [];
if ($userId > 0) {
    $sql .= ' AND user_id=?';
    $params[] = $userId;
}
$sql .= ' ORDER BY user_id,symbol';

$stmt = $pdo->prepare($sql);
$stmt->execute($params);
$securities = $stmt->fetchAll();

if (!$securities) {
    echo "Users processed: 0\n";
    echo "Securities priced: 0\n";
    echo "Failed: 0\n";
    exit(0);
}

// Group by user so each user's price rows are written with that user's
// id (prices.user_id is what scopes every read query).
$byUser = [];
foreach ($securities as $security) {
    $byUser[(int)$security['user_id']][] = $security;
}

$usersProcessed = 0;
$securitiesPriced = 0;
$failed = 0;
$allFailed = [];

foreach ($byUser as $uid => $userSecurities) {
    $usersProcessed++;
    if ($dryRun) {
        foreach ($userSecurities as $security) {
            echo "[dry-run] user={$uid} symbol={$security['symbol']} "
                . "source={$security['nav_source']} code={$security['nav_code']}\n";
            $securitiesPriced++;
        }
        continue;
    }
    $result = fetch_fund_nav_quotes($pdo, $userSecurities);
    $securitiesPriced += (int)($result['updated'] ?? 0);
    $failed += count($result['failed'] ?? []);
    foreach ($result['failed'] ?? [] as $entry) {
        $allFailed[] = "user={$uid} " . json_encode($entry, JSON_UNESCAPED_UNICODE);
    }
}

echo "Users processed: {$usersProcessed}\n";
echo "Securities priced: {$securitiesPriced}\n";
echo "Failed: {$failed}\n";
foreach ($allFailed as $line) {
    echo "  - {$line}\n";
}

// A non-zero exit tells cron the job needs attention (e.g. the issuer
// API was unreachable). Individual security failures are reported but do
// not fail the run — one stale fund code must not mask the others.
exit($securitiesPriced > 0 || $failed === 0 ? 0 : 1);
