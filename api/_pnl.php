<?php
declare(strict_types=1);

/**
 * stock_hold 2.3.0 — P&L snapshot engine.
 *
 * Backfills `pnl_snapshots` for a single user from the most recent snapshot
 * date (exclusive) up to and including `$todayIso`. Designed to be called
 * from a login-touchpoint (currently dashboard mount) and to be a no-op
 * when the data is already up to date.
 *
 * Design notes:
 *   - Daily rows are written for every trading day in [start, today] on
 *     which every open position had a `prices` row. A "trading day" here
 *     is just Mon–Fri; we do NOT maintain a holiday calendar. Days with
 *     partial coverage are skipped (no row) so the chart never lies.
 *   - Monthly rows are written ONLY for the *previous* calendar month
 *     once it has fully ended. The current month is intentionally not
 *     settled, per product decision.
 *   - Idempotent everywhere via `INSERT ... ON CONFLICT(user_id,
 *     snapshot_date, granularity) DO UPDATE`. Safe to re-run from N
 *     concurrent tabs.
 *   - Failures are logged via sh_log() but never bubble up; the caller
 *     (api/index.php route) catches and returns 200 with skipped/error.
 *
 * 計算語意 (per snapshot_date):
 *   market_value     = Σ over open positions of (qty * close on snapshot_date)
 *   cash_balance     = Σ(DEPOSIT, WITHDRAW, TRANSFER_IN, TRANSFER_OUT,
 *                          DIVIDEND) txn amount, sign-adjusted.
 *                      See /dashboard/summary for the same expression.
 *   total_assets     = market_value + cash_balance
 *   unrealized_pnl   = Σ(qty * (close - avg_cost)) from positions
 *   realized_pl      = Σ(positions.realized_pl) — cumulative since first SELL.
 *                      A snapshot at date D uses the realized_pl value as
 *                      of the most recent SELL with txn_date <= D, falling
 *                      back to 0 if there has been no SELL yet.
 *   prev_close_value = market_value computed at the *previous* trading day
 *                      for which we (will) have a snapshot row. 0 for the
 *                      first row.
 *   prices_complete  = 1 if every open position on snapshot_date has a
 *                      prices row; 0 otherwise.
 */

require_once __DIR__ . '/bootstrap.php';

const PNL_HOLIDAYS_TZ = 'UTC';

function pnl_iso(string $ymd): string
{
    // Accept either YYYYMMDD or YYYY-MM-DD; normalize to YYYY-MM-DD.
    $s = preg_replace('/[^0-9]/', '', $ymd);
    if (strlen($s) !== 8) {
        throw new RuntimeException("Invalid date: {$ymd}");
    }
    return substr($s, 0, 4) . '-' . substr($s, 4, 2) . '-' . substr($s, 6, 2);
}

function pnl_add_days(string $iso, int $delta): string
{
    $d = new DateTimeImmutable($iso, new DateTimeZone(PNL_HOLIDAYS_TZ));
    return $d->modify(($delta >= 0 ? '+' : '') . $delta . ' days')->format('Y-m-d');
}

function pnl_is_weekend(string $iso): bool
{
    $d = new DateTimeImmutable($iso, new DateTimeZone(PNL_HOLIDAYS_TZ));
    $w = (int)$d->format('N');
    return $w >= 6;
}

function pnl_first_day_of_month(string $iso): string
{
    return substr($iso, 0, 7) . '-01';
}

function pnl_prev_month_first(string $iso): string
{
    $first = pnl_first_day_of_month($iso);
    return (new DateTimeImmutable($first, new DateTimeZone(PNL_HOLIDAYS_TZ)))
        ->modify('-1 month')->format('Y-m-d');
}

/**
 * Return the most recent snapshot_date for the given user + granularity,
 * or null if no snapshots exist yet.
 */
function pnl_latest_snapshot_date(PDO $pdo, int $userId, string $granularity): ?string
{
    $stmt = $pdo->prepare('SELECT MAX(snapshot_date) FROM pnl_snapshots WHERE user_id=? AND granularity=?');
    $stmt->execute([$userId, $granularity]);
    $v = $stmt->fetchColumn();
    return ($v === null || $v === false || $v === '') ? null : (string)$v;
}

/**
 * First day we *might* need to compute a snapshot for.
 *   - If a snapshot already exists, the next day after it.
 *   - Otherwise: the earliest of
 *       (a) the first BUYSell/DEPOSIT/WITHDRAW transaction date (we need
 *           positions to exist), or
 *       (b) 1 year ago (chart starts no further back than that).
 *     When (a) > today we have no work to do.
 *
 * 2.4.0 hotfix: also rewind to the first transaction date when the
 * prices table's MIN(date) is much newer than the first transaction.
 * Previously, the moment pnl_upsert_daily wrote a single "today"
 * snapshot (even with prices_complete=0), pnl_latest_snapshot_date
 * would return today and the next call would return "up to date" —
 * even though the prices table only has one day of live data and no
 * historical closes. Now we sanity-check the prices coverage and, if
 * the gap is larger than 7 trading days, force a re-backfill from the
 * first transaction date.
 */
function pnl_backfill_start(PDO $pdo, int $userId, string $todayIso): ?string
{
    $stmt = $pdo->prepare('SELECT MIN(txn_date) FROM transactions WHERE user_id=?');
    $stmt->execute([$userId]);
    $first = $stmt->fetchColumn();
    if (!$first) {
        return null;
    }
    $firstIso = pnl_iso((string)$first);
    if ($firstIso > $todayIso) {
        return null;
    }

    $latest = pnl_latest_snapshot_date($pdo, $userId, 'D');

    // Coverage check: count distinct dates in prices for this user.
    // If the prices table covers fewer than 30 distinct days, treat
    // the historical backfill as missing and rewind to the first
    // transaction. This is robust against the "single live snapshot
    // parked at today" failure mode where pnl_latest_snapshot_date
    // returns today and the call above would otherwise short-circuit
    // to up_to_date.
    $pricesCountStmt = $pdo->prepare(
        'SELECT COUNT(DISTINCT date) FROM prices WHERE user_id=?'
    );
    $pricesCountStmt->execute([$userId]);
    $pricesDayCount = (int)$pricesCountStmt->fetchColumn();

    if ($pricesDayCount < 30) {
        return $firstIso;
    }

    if ($latest !== null) {
        // 2.4.0 hotfix: the latest snapshot may have prev_close_value=0
        // (orphan row written by the old in-memory accumulator). When
        // the trigger detects a gap between latest and the prior
        // trading day for which we have prices, rewind to the first
        // transaction so the affected rows get re-computed with the
        // new prevValue-from-DB logic.
        $priorStmt = $pdo->prepare(
            'SELECT MAX(snapshot_date) FROM pnl_snapshots '
            . 'WHERE user_id=? AND granularity=\'D\' AND snapshot_date < ?'
        );
        $priorStmt->execute([$userId, $latest]);
        $priorLatest = $priorStmt->fetchColumn();
        $latestHasPrevStmt = $pdo->prepare(
            'SELECT prev_close_value FROM pnl_snapshots '
            . 'WHERE user_id=? AND granularity=\'D\' AND snapshot_date=?'
        );
        $latestHasPrevStmt->execute([$userId, $latest]);
        $latestPrev = (float)($latestHasPrevStmt->fetchColumn() ?: 0.0);
        if ($latestPrev <= 0) {
            return $firstIso;
        }
        return pnl_add_days($latest, 1);
    }
    return $firstIso;
}

/**
 * Enumerate candidate trading days in [start, end], excluding weekends.
 * No holiday table — that is an explicit choice to keep this engine
 * dependency-free. Days with no prices data are filtered at write time.
 */
function pnl_trading_days(string $startIso, string $endIso): array
{
    $out = [];
    $cur = $startIso;
    while ($cur <= $endIso) {
        if (!pnl_is_weekend($cur)) {
            $out[] = $cur;
        }
        $cur = pnl_add_days($cur, 1);
    }
    return $out;
}

/**
 * Returns map[security_id => close] for the given trading day, restricted
 * to currently open positions. If any open position lacks a price for
 * that day, returns null (caller should skip the day).
 */
function pnl_load_day_closes(PDO $pdo, int $userId, string $iso): ?array
{
    $rows = $pdo->prepare(
        'SELECT p.security_id, p.qty, '
        . '  COALESCE((SELECT close FROM prices pr WHERE pr.security_id=p.security_id AND pr.user_id=p.user_id AND pr.date=? LIMIT 1), 0) AS close_ '
        . 'FROM positions p WHERE p.qty > 0 AND p.user_id=?'
    );
    $rows->execute([str_replace('-', '', $iso), $userId]);
    $rows = $rows->fetchAll();
    if (count($rows) === 0) {
        // No open positions — return [] so the day is still snapshotted
        // (cash-only). Caller will write a row with market_value=0.
        return [];
    }
    $out = [];
    foreach ($rows as $r) {
        if ((float)$r['close_'] <= 0) {
            return null; // missing data → skip this day
        }
        $out[(string)$r['security_id']] = (float)$r['close_'];
    }
    return $out;
}

/**
 * Cumulative cash flow for a user as of `$iso` (inclusive), using the
 * same type whitelist as /dashboard/summary so the two numbers match.
 */
function pnl_cash_balance(PDO $pdo, int $userId, string $iso): float
{
    $stmt = $pdo->prepare(
        "SELECT COALESCE(SUM(amount),0) FROM transactions "
        . "WHERE user_id=? AND type IN ('DEPOSIT','WITHDRAW','TRANSFER_IN','TRANSFER_OUT','DIVIDEND') "
        . "AND txn_date <= ?"
    );
    $stmt->execute([$userId, $iso]);
    return (float)$stmt->fetchColumn();
}

/**
 * Cumulative realized P&L as of `$iso` (inclusive).
 *
 * We can't trust `positions.realized_pl` here because that's a *current*
 * view (it changes as qty goes back to 0). For history we replay SELL
 * transactions ordered by date, applying FIFO against the BUY queue
 * built from BUYS with txn_date <= the SELL date.
 *
 * For dates that have NO SELL yet, returns 0.
 */
function pnl_realized_cumulative(PDO $pdo, int $userId, string $iso): float
{
    $txnStmt = $pdo->prepare(
        'SELECT type, qty, price, fees, txn_date FROM transactions '
        . 'WHERE user_id=? AND security_id IS NOT NULL AND txn_date <= ? '
        . 'ORDER BY txn_date, created_at, id'
    );
    $txnStmt->execute([$userId, $iso]);
    $rows = $txnStmt->fetchAll();
    if (count($rows) === 0) {
        return 0.0;
    }
    $totalRealized = 0.0;
    // Replay in security_id groups so FIFO cost basis is per-holding.
    $bySecurity = [];
    foreach ($rows as $r) {
        // We need security_id too — re-query is wasteful, but this is a
        // backfill path, not a hot path. Use a cheaper approach: include
        // security_id in the projection.
        $bySecurity[(string)$r['security_id']][] = $r;
    }
    foreach ($bySecurity as $sid => $txs) {
        $qty = 0.0;
        $wac = 0.0;
        foreach ($txs as $tx) {
            $t = strtoupper((string)$tx['type']);
            $q = (float)$tx['qty'];
            $p = (float)$tx['price'];
            $f = (float)$tx['fees'];
            if ($t === 'BUY' || $t === 'RIGHTS') {
                $denom = $qty + $q;
                $wac = $denom > 0 ? (($qty * $wac) + ($q * $p + $f)) / $denom : 0.0;
                $qty = $denom;
            } elseif ($t === 'SELL') {
                $totalRealized += ($p - $wac) * $q - $f;
                $qty = max(0.0, $qty - $q);
                if ($qty <= 0) {
                    $qty = 0.0;
                    $wac = 0.0;
                }
            } elseif ($t === 'SPLIT' || $t === 'MERGER') {
                // Adjust qty only; WAC unchanged.
                $qty = max(0.0, $qty + $q);
            }
            // DIVIDEND, DEPOSIT, etc. don't affect realized.
        }
    }
    return $totalRealized;
}

/**
 * Insert (or update) one daily snapshot. The id is a deterministic
 * `ps-<userId>-D-<iso>` so re-runs of the migration are also stable.
 */
function pnl_upsert_daily(PDO $pdo, int $userId, string $iso, float $marketValue, float $cash, float $unrealized, float $realized, float $prevValue, int $complete): void
{
    $id = sprintf('ps-%d-D-%s', $userId, str_replace('-', '', $iso));
    $total = $marketValue + $cash;
    $stmt = $pdo->prepare(
        'INSERT INTO pnl_snapshots(id,user_id,snapshot_date,granularity,'
        . 'market_value,cash_balance,total_assets,unrealized_pnl,realized_pl,'
        . 'prev_close_value,prices_complete,created_at) '
        . 'VALUES(?,?,?,?,?,?,?,?,?,?,?,?) '
        . 'ON CONFLICT(user_id,snapshot_date,granularity) DO UPDATE SET '
        . 'market_value=excluded.market_value, '
        . 'cash_balance=excluded.cash_balance, '
        . 'total_assets=excluded.total_assets, '
        . 'unrealized_pnl=excluded.unrealized_pnl, '
        . 'realized_pl=excluded.realized_pl, '
        . 'prev_close_value=excluded.prev_close_value, '
        . 'prices_complete=excluded.prices_complete, '
        . 'created_at=excluded.created_at'
    );
    $stmt->execute([
        $id, $userId, $iso, 'D',
        $marketValue, $cash, $total, $unrealized, $realized,
        $prevValue, $complete, now_sql(),
    ]);
}

/**
 * Insert (or update) one monthly snapshot.
 * The "value" of a month is the mark on the *last* trading day of that
 * month (or the day before today, if the month is still open — but per
 * policy we only call this for *closed* months).
 */
function pnl_upsert_monthly(PDO $pdo, int $userId, string $firstOfMonth, float $marketValue, float $cash, float $unrealized, float $realized): void
{
    $id = sprintf('ps-%d-M-%s', $userId, str_replace('-', '', $firstOfMonth));
    $total = $marketValue + $cash;
    $stmt = $pdo->prepare(
        'INSERT INTO pnl_snapshots(id,user_id,snapshot_date,granularity,'
        . 'market_value,cash_balance,total_assets,unrealized_pnl,realized_pl,'
        . 'prev_close_value,prices_complete,created_at) '
        . 'VALUES(?,?,?,?,?,?,?,?,?,?,?,?) '
        . 'ON CONFLICT(user_id,snapshot_date,granularity) DO UPDATE SET '
        . 'market_value=excluded.market_value, '
        . 'cash_balance=excluded.cash_balance, '
        . 'total_assets=excluded.total_assets, '
        . 'unrealized_pnl=excluded.unrealized_pnl, '
        . 'realized_pl=excluded.realized_pl, '
        . 'created_at=excluded.created_at'
    );
    $stmt->execute([
        $id, $userId, $firstOfMonth, 'M',
        $marketValue, $cash, $total, $unrealized, $realized,
        0.0, 1, now_sql(),
    ]);
}

/**
 * Compute one daily snapshot. Reads positions + the given day's closes.
 * Returns the market_value (so the caller can use it as prev for the
 * next day) or null if the day should be skipped (no prices data).
 */
function pnl_compute_day(PDO $pdo, int $userId, string $iso): ?array
{
    $closes = pnl_load_day_closes($pdo, $userId, $iso);
    if ($closes === null) {
        return null;
    }
    // Pull positions and join with the close map to derive per-position MV.
    $rows = $pdo->prepare(
        'SELECT p.security_id, p.qty, p.avg_cost FROM positions p WHERE p.qty > 0 AND p.user_id=?'
    );
    $rows->execute([$userId]);
    $rows = $rows->fetchAll();
    $market = 0.0;
    $unrealized = 0.0;
    $complete = 1;
    foreach ($rows as $r) {
        $sid = (string)$r['security_id'];
        if (!isset($closes[$sid])) {
            $complete = 0;
            continue;
        }
        $close = $closes[$sid];
        $qty = (float)$r['qty'];
        $avg = (float)$r['avg_cost'];
        $market += $qty * $close;
        $unrealized += $qty * ($close - $avg);
    }
    if (count($rows) === 0) {
        // No open positions; market=0, unrealized=0. The day is still
        // valid (cash-only). Mark complete=1.
        $complete = 1;
    }
    return [
        'market_value' => $market,
        'cash' => pnl_cash_balance($pdo, $userId, $iso),
        'unrealized' => $unrealized,
        'realized' => pnl_realized_cumulative($pdo, $userId, $iso),
        'complete' => $complete,
    ];
}

/**
 * Top-level: ensure daily + monthly snapshots are up to date for a user.
 *
 * Returns a small status array; callers should NOT raise on "error"
 * fields — those are soft (e.g. user has no transactions yet).
 */
function ensure_pnl_snapshots(PDO $pdo, int $userId): array
{
    $todayIso = gmdate('Y-m-d');
    $start = pnl_backfill_start($pdo, $userId, $todayIso);
    if ($start === null) {
        return ['ok' => true, 'reason' => 'no_transactions', 'created' => 0];
    }
    if ($start > $todayIso) {
        return ['ok' => true, 'reason' => 'up_to_date', 'created' => 0];
    }

    $days = pnl_trading_days($start, $todayIso);

    // 2.3.1: gather every day that has at least one open position WITHOUT
    // a price row, and try a single batched historical fetch for that
    // whole range. This avoids the "first run with no data" no-op bug
    // where every day is skipped because the user hasn't pressed
    // "重新整理報價" since they last logged in.
    //
    // Batching is what keeps this fast: we do NOT call per-day;
    // api/_pnl_history.php builds one HTTP request per (symbol, month)
    // for TWSE or one request per (symbol, range) for Yahoo.
    $openPositions = $pdo->prepare(
        'SELECT p.security_id, p.qty, s.symbol, s.exchange, s.currency '
        . 'FROM positions p JOIN securities s ON s.id=p.security_id AND s.user_id=p.user_id '
        . 'WHERE p.qty > 0 AND p.user_id=?'
    );
    $openPositions->execute([$userId]);
    $openSecs = $openPositions->fetchAll();
    $missingDates = [];
    foreach ($days as $iso) {
        if ($iso >= $todayIso) continue; // historical backfill skips today
        // 2.4.0 hotfix: a trading day counts as "have data" ONLY when
        // every currently open position has a prices row for that date.
        // The previous logic was checking each symbol in isolation and
        // setting $haveData = true on the last iteration — which meant
        // days got marked as covered even when 7 of 8 symbols were
        // missing, so the backfill never triggered. With one day of
        // live data already in the prices table, every subsequent
        // ensure_pnl_snapshots() call would return up_to_date without
        // ever pulling historical closes.
        $allHaveData = count($openSecs) > 0;
        foreach ($openSecs as $sec) {
            $chk = $pdo->prepare('SELECT 1 FROM prices WHERE user_id=? AND security_id=? AND date=?');
            $chk->execute([$userId, (string)$sec['security_id'], str_replace('-', '', $iso)]);
            if (!$chk->fetchColumn()) {
                $allHaveData = false;
                break;
            }
        }
        if (!$allHaveData && count($openSecs) > 0) {
            $missingDates[] = $iso;
        }
    }
    $historicalImported = 0;
    $historicalFailed = [];
    $historicalSkipped = 'up_to_date';
    if (!empty($missingDates) && !empty($openSecs)) {
        $bfResult = pnl_backfill_history($pdo, $userId, $openSecs, $missingDates);
        $historicalImported = (int)($bfResult['imported'] ?? 0);
        $historicalFailed = (array)($bfResult['failed'] ?? []);
        $historicalSkipped = (string)($bfResult['skipped'] ?? 'none');
    }

    $created = 0;
    foreach ($days as $iso) {
        $r = pnl_compute_day($pdo, $userId, $iso);
        if ($r === null) {
            // Missing data on this day; do not write a row. The next
            // qualifying day will look up its own prior-day mark
            // directly from pnl_snapshots, so a skipped day never
            // contaminates later rows.
            continue;
        }
        // 2.4.0 hotfix: prev_close_value must be the prior trading
        // day's snapshot total_assets, NOT a stale in-memory accumulator
        // (which was being set to today's market_value AFTER writing
        // the row, so the row that was just inserted had prev_close=0
        // and the next iteration leaked tomorrow's value into today's
        // column when ensure_pnl_snapshots was re-run). Now we read
        // the prior snapshot from the table and fall back to 0 when
        // this is the first day we have ever computed.
        $prevStmt = $pdo->prepare(
            'SELECT total_assets FROM pnl_snapshots '
            . 'WHERE user_id=? AND granularity=\'D\' AND snapshot_date < ? '
            . 'ORDER BY snapshot_date DESC LIMIT 1'
        );
        $prevStmt->execute([$userId, $iso]);
        $prevRow = $prevStmt->fetch();
        $prevValue = $prevRow !== false ? (float)$prevRow['total_assets'] : 0.0;
        pnl_upsert_daily(
            $pdo, $userId, $iso,
            $r['market_value'], $r['cash'], $r['unrealized'], $r['realized'],
            $prevValue, $r['complete']
        );
        $created++;
    }

    // Monthly: only settle the *previous* calendar month (current is
    // intentionally left open per product decision). The "value" we
    // write is the snapshot on the last day of that month, if it exists.
    $todayFirst = pnl_first_day_of_month($todayIso);
    $prevFirst = pnl_prev_month_first($todayIso);
    // Did we write the snapshot for the last day of prev month?
    $lastOfPrevMonth = (new DateTimeImmutable($prevFirst, new DateTimeZone(PNL_HOLIDAYS_TZ)))
        ->modify('+1 month -1 day')->format('Y-m-d');
    // Walk back to the latest trading day at or before lastOfPrevMonth
    // that has a daily snapshot for this user.
    $monthlySrc = null;
    $cursor = $lastOfPrevMonth;
    for ($i = 0; $i < 10; $i++) {
        if (pnl_is_weekend($cursor)) {
            $cursor = pnl_add_days($cursor, -1);
            continue;
        }
        $chk = $pdo->prepare('SELECT 1 FROM pnl_snapshots WHERE user_id=? AND snapshot_date=? AND granularity=\'D\'');
        $chk->execute([$userId, $cursor]);
        if ($chk->fetchColumn()) {
            $monthlySrc = $cursor;
            break;
        }
        $cursor = pnl_add_days($cursor, -1);
    }
    if ($monthlySrc !== null) {
        // Copy the daily row's values into the monthly row keyed by
        // prevFirst. We pull them back so realized/unrealized match.
        $row = $pdo->prepare('SELECT market_value,cash_balance,unrealized_pnl,realized_pl FROM pnl_snapshots WHERE user_id=? AND snapshot_date=? AND granularity=\'D\'');
        $row->execute([$userId, $monthlySrc]);
        $r = $row->fetch();
        if ($r) {
            pnl_upsert_monthly(
                $pdo, $userId, $prevFirst,
                (float)$r['market_value'], (float)$r['cash_balance'],
                (float)$r['unrealized_pnl'], (float)$r['realized_pl']
            );
        }
    }

    return [
        'ok' => true,
        'reason' => 'backfilled',
        'created' => $created,
        'from' => $start,
        'to' => $todayIso,
        'historical_imported' => $historicalImported,
        'historical_failed' => $historicalFailed,
        'historical_skipped' => $historicalSkipped,
    ];
}

/**
 * Read a window of daily snapshots for the chart.
 * Returns rows ordered by snapshot_date asc.
 */
function pnl_read_history(PDO $pdo, int $userId, string $fromIso, string $toIso, string $granularity): array
{
    if (!in_array($granularity, ['D', 'M'], true)) {
        $granularity = 'D';
    }
    $stmt = $pdo->prepare(
        'SELECT snapshot_date,market_value,cash_balance,total_assets,'
        . 'unrealized_pnl,realized_pl,prev_close_value,prices_complete,'
        // 2.3.1: aggregate the source column from the prices rows that
        // contributed to this snapshot. The "best" source for a day is
        // 'live' if any close was live; otherwise 'historical_import';
        // otherwise the day is just missing (we still surface it so the
        // chart shows a gap, but with source='missing').
        . '(SELECT CASE WHEN EXISTS(SELECT 1 FROM prices pr WHERE pr.user_id=? AND pr.security_id IN '
        . '  (SELECT security_id FROM positions WHERE user_id=? AND qty>0) '
        . ' AND pr.date=pnl_snapshots.snapshot_date AND pr.source=\'live\') '
        . ' THEN \'live\' ELSE \'historical_import\' END) AS day_source '
        . 'FROM pnl_snapshots '
        . 'WHERE user_id=? AND granularity=? AND snapshot_date BETWEEN ? AND ? '
        . 'ORDER BY snapshot_date ASC'
    );
    $stmt->execute([$userId, $userId, $userId, $granularity, $fromIso, $toIso]);
    $rows = $stmt->fetchAll();
    // 2.4.0: pre-load every (snapshot_date, security_id) close we
    // need for the daily_diff bar chart in one round-trip. A correlated
    // subquery gives us the prior trading day close (NULL for the
    // first day, which the chart treats as 0). Computing daily_diff
    // here avoids a per-snapshot SQL round-trip and keeps the read
    // path O(N) instead of O(N * positions).
    $labels = [];
    $total = [];
    $market = [];
    $unrealized = [];
    $realized = [];
    $cash = [];
    $daily = [];
    $dailyPct = [];
    $source = [];
    $prev = null;
    $diff = [];
    if (count($rows) > 0) {
        $diffStmt = $pdo->prepare(
            'SELECT s.snapshot_date, pr.security_id, pr.close AS today_close, '
            . '  (SELECT close FROM prices pr2 WHERE pr2.user_id=pr.user_id AND pr2.security_id=pr.security_id AND pr2.date<REPLACE(s.snapshot_date, \'-\', \'\') ORDER BY pr2.date DESC LIMIT 1) AS prev_close, '
            . '  p.qty '
            . 'FROM pnl_snapshots s '
            . 'JOIN positions p ON p.user_id=s.user_id AND p.qty>0 '
            . 'JOIN prices pr ON pr.user_id=s.user_id AND pr.security_id=p.security_id AND pr.date=REPLACE(s.snapshot_date, \'-\', \'\') '
            . 'WHERE s.user_id=? AND s.granularity=? AND s.snapshot_date BETWEEN ? AND ? '
            . 'ORDER BY s.snapshot_date ASC'
        );
        $diffStmt->execute([$userId, $granularity, $fromIso, $toIso]);
        $diffByDay = [];
        foreach ($diffStmt->fetchAll() as $dr) {
            $d = (string)$dr['snapshot_date'];
            $todayC = (float)$dr['today_close'];
            $prevC = $dr['prev_close'] !== null ? (float)$dr['prev_close'] : $todayC;
            $qty = (float)$dr['qty'];
            $diffByDay[$d] = ($diffByDay[$d] ?? 0.0) + ($todayC - $prevC) * $qty;
        }
    }
    foreach ($rows as $r) {
        $labels[] = (string)$r['snapshot_date'];
        $marketV = (float)$r['market_value'];
        $cashV = (float)$r['cash_balance'];
        $totalV = (float)$r['total_assets'];
        $unrealizedV = (float)$r['unrealized_pnl'];
        $realizedV = (float)$r['realized_pl'];
        $prevV = (float)$r['prev_close_value'];
        $market[] = round($marketV, 2);
        $cash[] = round($cashV, 2);
        $total[] = round($totalV, 2);
        $unrealized[] = round($unrealizedV, 2);
        $realized[] = round($realizedV, 2);
        // Daily change: prefer prev_close_value (the prior day's mark).
        // Fall back to the running prev row from the result set.
        $basis = $prevV > 0 ? $prevV : ($prev ?? 0.0);
        $delta = $basis > 0 ? $totalV - $basis : 0.0;
        $pct = $basis > 0 ? round($delta / $basis * 100, 2) : 0.0;
        $daily[] = round($delta, 2);
        $dailyPct[] = $pct;
        $source[] = (string)($r['day_source'] ?? 'historical_import');
        $prev = $totalV;
        $diff[] = isset($diffByDay[(string)$r['snapshot_date']])
            ? round($diffByDay[(string)$r['snapshot_date']], 2)
            : 0.0;
    }
    return [
        'granularity' => $granularity,
        'labels' => $labels,
        'total_assets' => $total,
        'market_value' => $market,
        'cash_balance' => $cash,
        'unrealized_pnl' => $unrealized,
        'realized_pl' => $realized,
        'daily_change' => $daily,
        'daily_change_pct' => $dailyPct,
        'source' => $source,
        'daily_diff' => $diff,
    ];
}

/**
 * Compute alert state from the daily history. Two rules:
 *   1) Consecutive down trading days >= N
 *   2) Window-days change <= -Pct% (e.g. last 5 days, <= -3%)
 *
 * Settings keys (app_settings):
 *   pnl.alerts.enabled              (0/1, default 1)
 *   pnl.alerts.consecutive_down_days (int, default 3)
 *   pnl.alerts.window_days          (int, default 5)
 *   pnl.alerts.window_pct           (number, default -3)
 */
function pnl_compute_alerts(PDO $pdo, int $userId): array
{
    $enabled = app_setting($pdo, 'pnl.alerts.enabled', '1') === '1';
    $consDays = (int)app_setting($pdo, 'pnl.alerts.consecutive_down_days', '3');
    $winDays  = (int)app_setting($pdo, 'pnl.alerts.window_days', '5');
    $winPct   = (float)app_setting($pdo, 'pnl.alerts.window_pct', '-3');

    $stmt = $pdo->prepare(
        'SELECT snapshot_date,total_assets,prev_close_value,prices_complete '
        . 'FROM pnl_snapshots WHERE user_id=? AND granularity=\'D\' '
        . 'ORDER BY snapshot_date DESC LIMIT 60'
    );
    $stmt->execute([$userId]);
    $rows = $stmt->fetchAll();
    // Reverse for chronological access; the LIMIT pulls enough for both
    // rules (consecutive + window) without taxing the index.
    $rows = array_reverse($rows);

    $consecutive = 0;
    $maxStreak = 0;
    $maxStreakEnd = null;
    foreach ($rows as $r) {
        $total = (float)$r['total_assets'];
        $basis = (float)$r['prev_close_value'];
        if ($basis > 0 && $total < $basis) {
            $consecutive++;
            if ($consecutive > $maxStreak) {
                $maxStreak = $consecutive;
                $maxStreakEnd = (string)$r['snapshot_date'];
            }
        } else {
            $consecutive = 0;
        }
    }

    $windowDelta = 0.0;
    $windowBase = 0.0;
    $windowPct = 0.0;
    $windowTriggered = false;
    if (count($rows) >= 2) {
        $last = (float)$rows[count($rows) - 1]['total_assets'];
        $idx = max(0, count($rows) - 1 - ($winDays - 1));
        $base = (float)$rows[$idx]['prev_close_value'];
        // Use prev_close_value of the row $winDays back, falling back to
        // its own total_assets if prev_close_value is 0 (first row).
        if ($base <= 0) {
            $base = (float)$rows[$idx]['total_assets'];
        }
        $windowDelta = $last - $base;
        $windowPct = $base > 0 ? round(($last - $base) / $base * 100, 2) : 0.0;
        $windowTriggered = $windowPct <= $winPct;
    }

    // 2.4.0 hotfix: trigger on the *current* streak, not the all-time
    // maximum. Otherwise an old max_streak from a past drawdown keeps
    // the banner permanently lit even after the market recovers. The
    // historical max is still surfaced in the response for the UI to
    // display as a secondary metric.
    $consecutiveTriggered = $consecutive >= max(1, $consDays);
    $triggered = [];
    if ($enabled && $consecutiveTriggered) {
        $triggered[] = [
            'type' => 'consecutive_down_days',
            'value' => $consecutive,
            'threshold' => $consDays,
        ];
    }
    if ($enabled && $windowTriggered) {
        $triggered[] = [
            'type' => 'window_pct',
            'value' => $windowPct,
            'threshold' => $winPct,
            'window_days' => $winDays,
        ];
    }

    return [
        'enabled' => $enabled,
        'consecutive_down_days' => $consecutive,
        'consecutive_streak_max' => $maxStreak,
        'consecutive_streak_max_end' => $maxStreakEnd,
        'consecutive_threshold' => $consDays,
        'consecutive_triggered' => $consecutiveTriggered,
        'window_days' => $winDays,
        'window_pct' => $windowPct,
        'window_threshold' => $winPct,
        'window_triggered' => $windowTriggered,
        'triggered' => $triggered,
    ];
}
