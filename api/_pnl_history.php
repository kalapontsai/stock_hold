<?php
declare(strict_types=1);

/**
 * stock_hold 2.3.1 — Historical price backfill for P&L snapshots.
 *
 * The dashboard's fire-and-forget `ensure_pnl_snapshots()` calls into
 * here when it finds a trading day in [start, today] that has no
 * `prices` row for one of the user's open positions. We don't re-fetch
 * today's data (that's the live provider's job); we only fill in the
 * past.
 *
 * Provider dispatch mirrors /prices/batch-update — the source of truth
 * is `app_settings.quotes.provider`:
 *
 *   twse_mis   → fetch_twse_daily_history (TWSE 個股日線 STOCK_DAY)
 *   yahoo      → fetch_yahoo_history (Yahoo chart range)
 *   fubon      → NOT_IMPLEMENTED (binary SDK limitation, same as live)
 *   manual     → no-op (user has no quote source, can't backfill)
 *
 * Range bound: `app_settings.pnl.historical.max_lookback_days` (default
 * 365). Days further back than that are not requested.
 *
 * SSRF: every URL is built from a hard-coded host + a user-supplied
 * symbol + a numeric YYYYMM. No redirect following, no user-controlled
 * hostnames.
 */

require_once __DIR__ . '/bootstrap.php';

const PNL_HIST_TWSE_HOST = 'https://www.twse.com.tw';
const PNL_HIST_YAHOO_HOST = 'https://query1.finance.yahoo.com';
const PNL_HIST_FINMIND_HOST = 'https://api.finmindtrade.com';

/**
 * Top-level: pull historical closes for a (symbol, date) set, persist
 * to `prices` with source='historical_import', return counts.
 *
 * @param PDO $pdo
 * @param int $userId
 * @param array $securities   same shape as fetch_twse_mis_quotes input
 * @param array $dates        YYYY-MM-DD list to fill (we dedupe internally)
 * @return array { imported:int, failed:array, skipped:string }
 */
function pnl_backfill_history(PDO $pdo, int $userId, array $securities, array $dates): array
{
    if (empty($securities) || empty($dates)) {
        return ['imported' => 0, 'failed' => [], 'skipped' => 'empty'];
    }
    $provider = app_setting($pdo, 'quotes.provider', 'twse_mis');
    if ($provider === 'manual') {
        return ['imported' => 0, 'failed' => [], 'skipped' => 'manual_provider'];
    }
    if ($provider === 'fubon') {
        return ['imported' => 0, 'failed' => [], 'skipped' => 'fubon_not_implemented'];
    }

    // Cap lookback per user-tunable setting (default 365).
    $maxLookback = (int)app_setting($pdo, 'pnl.historical.max_lookback_days', '365');
    if ($maxLookback < 1) $maxLookback = 365;
    $todayIso = gmdate('Y-m-d');
    $earliestIso = (new DateTimeImmutable($todayIso, new DateTimeZone('UTC')))
        ->modify('-' . $maxLookback . ' days')->format('Y-m-d');
    $dates = array_values(array_filter($dates, static function (string $d) use ($earliestIso, $todayIso): bool {
        return $d >= $earliestIso && $d < $todayIso; // strictly past
    }));
    if (empty($dates)) {
        return ['imported' => 0, 'failed' => [], 'skipped' => 'beyond_lookback'];
    }
    sort($dates);
    $fromIso = $dates[0];
    $toIso = $dates[count($dates) - 1];

    if ($provider === 'yahoo') {
        return pnl_backfill_yahoo($pdo, $userId, $securities, $fromIso, $toIso);
    }
    if ($provider === 'finmind') {
        return pnl_backfill_finmind($pdo, $userId, $securities, $fromIso, $toIso);
    }
    // twse_mis (default)
    return pnl_backfill_twse($pdo, $userId, $securities, $fromIso, $toIso);
}

/**
 * Persist a list of (security_id, date, open/high/low/close/volume,
 * currency) rows into `prices` with source='historical_import'.
 *
 * Same UPSERT shape as persist_prices() in api/index.php, but the
 * source column is forced to 'historical_import' and the id is a
 * deterministic `ph-<userId>-<securityId>-<date>` (so re-runs of
 * the backfill replace the same row cleanly).
 */
function pnl_persist_history(PDO $pdo, int $userId, array $items): int
{
    if (empty($items)) return 0;
    $stmt = $pdo->prepare(
        'INSERT INTO prices (id,security_id,date,open,high,low,close,volume,currency,created_at,user_id,source) '
        . 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?) '
        . 'ON CONFLICT(security_id,date) DO UPDATE SET '
        . 'open=excluded.open, high=excluded.high, low=excluded.low, '
        . 'close=excluded.close, volume=excluded.volume, currency=excluded.currency, '
        . 'created_at=excluded.created_at, user_id=excluded.user_id, '
        . 'source=CASE WHEN prices.source=\'live\' THEN prices.source ELSE excluded.source END'
    );
    // NB: the ON CONFLICT keeps 'live' if a live row already exists.
    // That way a same-day refresh-after-backfill upgrades a historical
    // row to live instead of overwriting fresh data with stale.
    $count = 0;
    // 2.4.0 DEBUG: log entry shape and exit count so we can see if
    // items are reaching the foreach at all.
    sh_log('info', 'pnl.persist_history.start', [
        'user_id' => $userId,
        'items_count' => count($items),
        'first_item' => $items[0] ?? null,
    ]);
    foreach ($items as $itIdx => $it) {
        $close = (float)$it['close'];
        $open = isset($it['open']) ? (float)$it['open'] : $close;
        $high = isset($it['high']) ? (float)$it['high'] : $close;
        $low = isset($it['low']) ? (float)$it['low'] : $close;
        $vol = isset($it['volume']) ? (float)$it['volume'] : 0.0;
        $id = sprintf('ph-%d-%s-%s', $userId, substr((string)$it['security_id'], 0, 12), $it['date']);
        try {
            $stmt->execute([
                $id,
                (string)$it['security_id'],
                (string)$it['date'],
                $open, $high, $low, $close, $vol,
                strtoupper((string)($it['currency'] ?? 'TWD')),
                now_sql(),
                $userId,
                'historical_import',
            ]);
            $count++;
        } catch (Throwable $rowErr) {
            // 2.4.0 hotfix: per-row try/catch so one bad row doesn't
            // kill the whole backfill. We log the item shape that
            // triggered the FK/CHECK/etc so we can see exactly which
            // column is wrong. Without this, a single malformed row
            // surfaces as a generic PDOException from a 2000-row
            // fetch and we can't tell which symbol/date was bad.
            sh_log('error', 'pnl.persist_history.row_failed', [
                'user_id' => $userId,
                'index' => $itIdx,
                'item' => $it,
                'error' => $rowErr->getMessage(),
            ]);
        }
    }
    sh_log('info', 'pnl.persist_history.end', [
        'user_id' => $userId,
        'items_count' => count($items),
        'imported' => $count,
    ]);
    return $count;
}

// ────────────────────────────────────────────────────────────────────
// TWSE 個股日線
// ────────────────────────────────────────────────────────────────────

/**
 * Backfill via TWSE STOCK_DAY (https://www.twse.com.tw/exchangeReport/
 * STOCK_DAY?date=YYYYMM01&stockNo=2330). One HTTP call per (symbol,
 * month) — the endpoint returns a single calendar month per request.
 *
 * This is a slow path. We bound the work by:
 *   - dedupe symbols up front
 *   - only fetch months that overlap the requested date range
 *   - skip non-TW exchanges
 */
function pnl_backfill_twse(PDO $pdo, int $userId, array $securities, string $fromIso, string $toIso): array
{
    if (!function_exists('curl_init')) {
        sh_log('error', 'pnl.historical.dependency_missing', ['provider' => 'twse_mis']);
        return ['imported' => 0, 'failed' => [], 'skipped' => 'curl_missing'];
    }
    $bySecId = [];
    foreach ($securities as $s) {
        $exchange = strtoupper((string)($s['exchange'] ?? ''));
        if (!in_array($exchange, ['TW', 'OTC', 'TPEX', ''], true)) {
            // Non-TW security; TWSE endpoint can't serve it.
            continue;
        }
        $bySecId[(string)$s['id']] = $s;
    }
    if (empty($bySecId)) {
        return ['imported' => 0, 'failed' => [], 'skipped' => 'no_tw_symbols'];
    }
    $months = pnl_months_in_range($fromIso, $toIso);
    $items = [];
    $failed = [];
    foreach ($bySecId as $sec) {
        $symbol = (string)$sec['symbol'];
        foreach ($months as $ym) {
            $url = PNL_HIST_TWSE_HOST . '/exchangeReport/STOCK_DAY'
                . '?response=json&date=' . $ym . '01&stockNo=' . rawurlencode($symbol);
            $rows = pnl_http_get_json($url, 15, 5);
            if ($rows === null) {
                $failed[] = ['symbol' => $symbol, 'month' => $ym, 'reason' => 'twse_http_failed'];
                usleep(200000); // be polite
                continue;
            }
            // Response shape: { stat:'OK', data:[[date,'YYYY/MM/DD',...,'close',...], ...] }
            // TWSE date field is the 2nd column (index 1). Close price is
            // conventionally the 7th column (index 6) but the only stable
            // anchor is the "stat" + a non-empty data array.
            $stat = (string)($rows['stat'] ?? '');
            $data = $rows['data'] ?? null;
            if ($stat !== 'OK' || !is_array($data) || count($data) === 0) {
                // Empty months are normal (pre-IPO, etc.) — don't pollute failed.
                usleep(200000);
                continue;
            }
            // TWSE date format: "114/10/12" (ROC year + slash). We convert
            // to Gregorian YYYYMMDD. ROC year + 1911 = CE year.
            foreach ($data as $row) {
                if (!is_array($row) || count($row) < 7) continue;
                $twDate = (string)$row[1];
                $m = pnl_parse_roc_date($twDate);
                if ($m === null) continue;
                $yyyymmdd = $m['yyyymmdd'];
                $iso = $m['iso'];
                if ($iso < $fromIso || $iso > $toIso) continue;
                $closeStr = trim((string)$row[6]);
                // Strip thousand separators.
                $closeStr = str_replace([',', ' '], '', $closeStr);
                if ($closeStr === '' || $closeStr === '--' || !is_numeric($closeStr)) continue;
                $items[] = [
                    'security_id' => (string)$sec['security_id'],
                    'date' => $yyyymmdd,
                    'close' => (float)$closeStr,
                    'open' => (float)str_replace([',', ' '], '', (string)($row[3] ?? $closeStr)),
                    'high' => (float)str_replace([',', ' '], '', (string)($row[4] ?? $closeStr)),
                    'low'  => (float)str_replace([',', ' '], '', (string)($row[5] ?? $closeStr)),
                    'volume' => (float)str_replace([',', ' '], '', (string)($row[2] ?? '0')),
                    'currency' => (string)($sec['currency'] ?? 'TWD'),
                ];
            }
            usleep(200000); // be polite to TWSE
        }
    }
    $imported = pnl_persist_history($pdo, $userId, $items);
    sh_log('info', 'pnl.historical.twse', [
        'user_id' => $userId, 'symbols' => count($bySecId),
        'months' => count($months), 'rows_collected' => count($items),
        'rows_imported' => $imported, 'failed' => count($failed),
    ]);
    return ['imported' => $imported, 'failed' => $failed, 'skipped' => 'none'];
}

// ────────────────────────────────────────────────────────────────────
// Yahoo chart range
// ────────────────────────────────────────────────────────────────────

/**
 * Backfill via Yahoo chart range endpoint. One HTTP call per symbol
 * (the chart endpoint accepts a date range), much faster than TWSE.
 *
 * Symbol mapping mirrors fetch_yahoo_quotes():
 *   OTC / TPEx → .TWO ; TW → .TW ; else pass-through.
 *
 * Response: { chart:{ result:[{ meta:{currency,...}, timestamp:[...],
 *   indicators:{ quote:[{ open, high, low, close, volume }] } }] } }
 */
function pnl_backfill_yahoo(PDO $pdo, int $userId, array $securities, string $fromIso, string $toIso): array
{
    if (!function_exists('curl_init')) {
        sh_log('error', 'pnl.historical.dependency_missing', ['provider' => 'yahoo']);
        return ['imported' => 0, 'failed' => [], 'skipped' => 'curl_missing'];
    }
    $items = [];
    $failed = [];
    $ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    $period1 = (new DateTimeImmutable($fromIso, new DateTimeZone('UTC')))->getTimestamp();
    // +1 day so toIso is inclusive (Yahoo's period2 is exclusive).
    $period2 = (new DateTimeImmutable($toIso, new DateTimeZone('UTC')))
        ->modify('+1 day')->getTimestamp();

    foreach ($securities as $sec) {
        $exchange = strtoupper((string)($sec['exchange'] ?? ''));
        $symbol = (string)$sec['symbol'];
        if ($symbol === '') continue;
        if ($exchange === 'OTC' || $exchange === 'TPEX') {
            $yahooSymbol = $symbol . '.TWO';
        } elseif ($exchange === 'TW') {
            $yahooSymbol = $symbol . '.TW';
        } else {
            $yahooSymbol = $symbol;
        }
        $url = PNL_HIST_YAHOO_HOST . '/v8/finance/chart/' . rawurlencode($yahooSymbol)
            . '?period1=' . $period1 . '&period2=' . $period2
            . '&interval=1d&includePrePost=false';
        $payload = pnl_http_get_json($url, 15, 5, $ua);
        if ($payload === null) {
            $failed[] = ['symbol' => $symbol, 'reason' => 'yahoo_http_failed'];
            usleep(200000);
            continue;
        }
        $chart = $payload['chart'] ?? null;
        if (!is_array($chart) || !empty($chart['error'])) {
            $errMsg = is_array($chart['error'] ?? null)
                ? (string)($chart['error']['description'] ?? ($chart['error']['code'] ?? 'unknown'))
                : 'unknown';
            $failed[] = ['symbol' => $symbol, 'reason' => 'yahoo_error:' . $errMsg];
            usleep(200000);
            continue;
        }
        $result = $chart['result'][0] ?? null;
        if (!is_array($result)) {
            $failed[] = ['symbol' => $symbol, 'reason' => 'yahoo_empty_result'];
            usleep(200000);
            continue;
        }
        $meta = $result['meta'] ?? [];
        $indicators = $result['indicators']['quote'][0] ?? [];
        $timestamps = $result['timestamp'] ?? [];
        $opens = $indicators['open'] ?? [];
        $highs = $indicators['high'] ?? [];
        $lows  = $indicators['low'] ?? [];
        $closes = $indicators['close'] ?? [];
        $vols = $indicators['volume'] ?? [];
        $currency = strtoupper((string)($meta['currency'] ?? $sec['currency'] ?? 'USD'));
        $count = count($timestamps);
        for ($i = 0; $i < $count; $i++) {
            $ts = $timestamps[$i] ?? null;
            $close = $closes[$i] ?? null;
            if ($ts === null || $close === null || !is_numeric($close)) continue;
            $iso = gmdate('Y-m-d', (int)$ts);
            $yyyymmdd = gmdate('Ymd', (int)$ts);
            if ($iso < $fromIso || $iso > $toIso) continue;
            $items[] = [
                'security_id' => (string)$sec['security_id'],
                'date' => $yyyymmdd,
                'open' => isset($opens[$i]) && is_numeric($opens[$i]) ? (float)$opens[$i] : (float)$close,
                'high' => isset($highs[$i]) && is_numeric($highs[$i]) ? (float)$highs[$i] : (float)$close,
                'low'  => isset($lows[$i])  && is_numeric($lows[$i])  ? (float)$lows[$i]  : (float)$close,
                'close' => (float)$close,
                'volume' => isset($vols[$i]) && is_numeric($vols[$i]) ? (float)$vols[$i] : 0.0,
                'currency' => $currency,
            ];
        }
        usleep(200000);
    }
    $imported = pnl_persist_history($pdo, $userId, $items);
    sh_log('info', 'pnl.historical.yahoo', [
        'user_id' => $userId, 'symbols' => count($securities),
        'rows_collected' => count($items), 'rows_imported' => $imported,
        'failed' => count($failed),
    ]);
    return ['imported' => $imported, 'failed' => $failed, 'skipped' => 'none'];
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function pnl_http_get_json(string $url, int $timeoutSec, int $connectSec, ?string $ua = null): ?array
{
    $ch = curl_init($url);
    $headers = ['Accept: application/json'];
    if ($ua !== null) $headers[] = 'User-Agent: ' . $ua;
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => $connectSec,
        CURLOPT_TIMEOUT => $timeoutSec,
        CURLOPT_HTTPHEADER => $headers,
    ]);
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($raw === false || $status < 200 || $status >= 300) return null;
    $payload = json_decode($raw, true);
    return is_array($payload) ? $payload : null;
}

// ────────────────────────────────────────────────────────────────────
// FinMind backfill (2.4.0)
// ────────────────────────────────────────────────────────────────────

/**
 * Backfill via FinMind TaiwanStockPrice dataset (2.4.0). One HTTP
 * call per symbol — the dataset accepts a date range so a single
 * request covers the whole backfill window. ~1 req/symbol — polite
 * 200ms sleep between symbols, well under the free-tier 600 req/hr
 * limit.
 *
 * Reads the user's finmind_token from extension_api_keys (same
 * encryption path as the live provider). Returns the standard
 * {imported, failed, skipped} tuple.
 */
function pnl_backfill_finmind(PDO $pdo, int $userId, array $securities, string $fromIso, string $toIso): array
{
    if (!function_exists('curl_init')) {
        sh_log('error', 'pnl.historical.dependency_missing', ['provider' => 'finmind']);
        return ['imported' => 0, 'failed' => [], 'skipped' => 'curl_missing'];
    }
    // Pull the user's finmind_token (decrypted). If missing, refuse
    // gracefully — caller may have the live provider set to finmind
    // without a token (UI guard catches this earlier, but defensive
    // here too).
    $stmt = $pdo->prepare('SELECT key_ciphertext, key_iv FROM extension_api_keys WHERE user_id=? AND provider=?');
    $stmt->execute([$userId, 'finmind_token']);
    $keyRow = $stmt->fetch();
    if (!$keyRow) {
        return ['imported' => 0, 'failed' => [], 'skipped' => 'finmind_token_missing'];
    }
    if (!function_exists('extension_key_decrypt')) {
        return ['imported' => 0, 'failed' => [], 'skipped' => 'decrypt_unavailable'];
    }
    $apiKey = extension_key_decrypt((string)$keyRow['key_ciphertext'], (string)$keyRow['key_iv']);
    if ($apiKey === null || $apiKey === '') {
        return ['imported' => 0, 'failed' => [], 'skipped' => 'finmind_token_decrypt_failed'];
    }

    $items = [];
    $failed = [];
    // FinMind's free tier returns up to 6000 rows per request; for a
    // 365-day window that's well inside the limit. We still cap
    // start_date to 2010-01-01 because the dataset starts there.
    $fromDate = (new DateTimeImmutable($fromIso, new DateTimeZone('UTC')))
        ->format('Y-m-d');
    $toDate = (new DateTimeImmutable($toIso, new DateTimeZone('UTC')))
        ->format('Y-m-d');
    $floorDate = '2010-01-01';
    if ($fromDate < $floorDate) $fromDate = $floorDate;

    foreach ($securities as $sec) {
        $symbol = (string)($sec['symbol'] ?? '');
        $exchange = strtoupper((string)($sec['exchange'] ?? ''));
        if ($symbol === '') continue;
        // FinMind TaiwanStockPrice only covers TW tickers; the free
        // tier does NOT serve US / HK / JP. Skip non-TW securities
        // silently — they'll show up as missing data in the chart,
        // which is the same behaviour as before this provider existed.
        if (!in_array($exchange, ['', 'TW', 'OTC', 'TPEX'], true)) {
            $failed[] = ['symbol' => $symbol, 'reason' => 'finmind_tw_only'];
            usleep(200000);
            continue;
        }
        $url = PNL_HIST_FINMIND_HOST . '/api/v4/data'
            . '?dataset=TaiwanStockPrice'
            . '&data_id=' . rawurlencode($symbol)
            . '&start_date=' . $fromDate
            . '&end_date=' . $toDate
            . '&token=' . rawurlencode($apiKey);
        $payload = pnl_http_get_json($url, 30, 5, 'stock-portfolio-forecast/1.0 (Flask)');
        // 2.4.0 DEBUG: per-symbol fetch trace.
        sh_log('info', 'pnl.backfill_finmind.fetch', [
            'symbol' => $symbol, 'from' => $fromDate, 'to' => $toDate,
        ]);
        if ($payload === null) {
            $failed[] = ['symbol' => $symbol, 'reason' => 'finmind_http_failed'];
            sh_log('warn', 'pnl.backfill_finmind.http_failed', ['symbol' => $symbol]);
            usleep(200000);
            continue;
        }
        $payloadStatus = $payload['status'] ?? null;
        $payloadMsg = $payload['msg'] ?? null;
        $payloadDataCount = is_array($payload['data'] ?? null) ? count($payload['data']) : 0;
        sh_log('info', 'pnl.backfill_finmind.payload', [
            'symbol' => $symbol,
            'status' => $payloadStatus,
            'msg' => $payloadMsg,
            'data_count' => $payloadDataCount,
        ]);
        if (!isset($payload['data']) || !is_array($payload['data']) || count($payload['data']) === 0) {
            $errMsg = is_array($payload['msg'] ?? null) ? (string)($payload['msg'][0] ?? 'unknown') : 'no_data';
            $failed[] = ['symbol' => $symbol, 'reason' => 'finmind:' . $errMsg];
            usleep(200000);
            continue;
        }
        foreach ($payload['data'] as $row) {
            if (!is_array($row)) continue;
            $dateRaw = (string)($row['date'] ?? '');
            $yyyymmdd = preg_replace('/[^0-9]/', '', $dateRaw);
            if ($yyyymmdd === '' || strlen($yyyymmdd) !== 8) continue;
            $close = isset($row['close']) ? (float)$row['close'] : 0.0;
            if ($close <= 0) continue;
            $open = isset($row['open']) && is_numeric($row['open']) ? (float)$row['open'] : $close;
            $high = isset($row['max']) && is_numeric($row['max']) ? (float)$row['max'] : $close;
            $low = isset($row['min']) && is_numeric($row['min']) ? (float)$row['min'] : $close;
            $vol = isset($row['Trading_Volume']) && is_numeric($row['Trading_Volume']) ? (float)$row['Trading_Volume'] : 0.0;
            $items[] = [
                'security_id' => (string)$sec['security_id'],
                'date' => $yyyymmdd,
                'open' => $open,
                'high' => $high,
                'low' => $low,
                'close' => $close,
                'volume' => $vol,
                'currency' => (string)($sec['currency'] ?? 'TWD'),
            ];
        }
        usleep(200000);
    }
    $imported = pnl_persist_history($pdo, $userId, $items);
    sh_log('info', 'pnl.historical.finmind', [
        'user_id' => $userId, 'symbols' => count($securities),
        'rows_collected' => count($items), 'rows_imported' => $imported,
        'failed' => count($failed),
    ]);
    return ['imported' => $imported, 'failed' => $failed, 'skipped' => 'none'];
}

function pnl_months_in_range(string $fromIso, string $toIso): array
{
    $start = new DateTimeImmutable(substr($fromIso, 0, 7) . '-01', new DateTimeZone('UTC'));
    $end = new DateTimeImmutable(substr($toIso, 0, 7) . '-01', new DateTimeZone('UTC'));
    $out = [];
    $cur = $start;
    while ($cur <= $end) {
        $out[] = $cur->format('Ym');
        $cur = $cur->modify('+1 month');
    }
    return $out;
}

function pnl_parse_roc_date(string $s): ?array
{
    // Input: "114/10/12" (ROC year/month/day). Output: { iso, yyyymmdd }.
    if (!preg_match('#^(\d{2,3})/(\d{1,2})/(\d{1,2})$#', trim($s), $m)) {
        return null;
    }
    $roc = (int)$m[1];
    $mo = (int)$m[2];
    $dy = (int)$m[3];
    if ($mo < 1 || $mo > 12 || $dy < 1 || $dy > 31) return null;
    $ce = $roc + 1911;
    if ($ce < 1990 || $ce > 2100) return null;
    $iso = sprintf('%04d-%02d-%02d', $ce, $mo, $dy);
    $yyyymmdd = sprintf('%04d%02d%02d', $ce, $mo, $dy);
    return ['iso' => $iso, 'yyyymmdd' => $yyyymmdd];
}
