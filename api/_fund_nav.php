<?php
declare(strict_types=1);

/**
 * stock_hold 2.5.0 — Fund NAV (單位淨值) quote providers.
 *
 * Why this module exists
 * ---------------------
 * A Taiwanese fund unit (共同基金受益權單位, ETF 連結基金級別) is NOT an
 * exchange-listed ticker. It has no TWSE/TPEx symbol, so MIS / FinMind /
 * Yahoo all fail to resolve it and the security keeps a NULL close — the
 * holdings view then shows 現價 0 / 市值 0 / 未實現損益 0.
 *
 * A fund unit is instead priced by its 單位淨值 (NAV), published once per
 * business day by the fund house. The issuer publishes it on a stable
 * JSON API, so one adapter per issuer covers every fund that issuer
 * offers: adding a fund is a data row (securities.nav_code), not a new
 * program. That is the structural difference from the per-fund CGI /
 * ActiveX approach, which would need one bespoke scraper per fund and
 * could not run on this app's Linux/Apache deployment anyway.
 *
 * Data flow
 * ----------
 *   securities.nav_source = 'yuanta'  →  securities.nav_code = '1250'
 *        ↓
 *   fetch_fund_nav_quotes()  →  yuanta_nav_history()  →  prices rows
 *        ↓                        (issuer JSON API)
 *   prices.source = 'fund_nav', date = NAV date, close = NAV
 *        ↓
 *   the existing holdings / dashboard / P&L queries read prices as usual,
 *   so 現價 / 市值 / 未實現損益 light up with no downstream change.
 *
 * Provider contract
 * ------------------
 *   A provider is a callable
 *       fn(string $navCode): array{items: array<int, array{date: string,
 *                                                   nav: string}>,}
 *   returning NAV rows newest-first, where date is 'Ymd' (the same
 *   format the `prices` table and every other quote provider use).
 *
 * Security notes
 * --------------
 *   * The issuer host is hard-coded per provider. nav_code is the ONLY
 *     user-controlled part and it is validated to a short alphanumeric
 *     token before it reaches the URL.
 *   * No CURLOPT_FOLLOWLOCATION: a redirect must not be able to steer the
 *     request to another host (same rule as the other fetchers).
 *   * Errors are per-security, never fatal: one bad nav_code must not
 *     abort the quote refresh for the other holdings.
 */

require_once __DIR__ . '/bootstrap.php';

/**
 * Provider registry. Key is the value stored in securities.nav_source.
 *
 * Each entry maps to a callable implementing the provider contract above.
 * Adding a new issuer = add one entry + one adapter function; adding a
 * new fund of an existing issuer = set securities.nav_code, nothing else.
 */
function fund_nav_providers(): array
{
    return [
        'yuanta' => 'yuanta_nav_history',
    ];
}

/**
 * Normalise the NAV source/code pair coming from a securities payload.
 *
 * Both fields are optional: a security without them keeps using the
 * normal market quote providers. When nav_source is present, nav_code is
 * required and must be a valid identifier — a fund with no code could
 * never be priced, so we reject the write instead of storing a security
 * that silently shows 現價 0.
 *
 * @return array{0: string|null, 1: string|null} [nav_source, nav_code]
 */
function security_nav_input(array $input): array
{
    $source = strtolower(trim((string)($input['nav_source'] ?? '')));
    $code = trim((string)($input['nav_code'] ?? ''));

    if ($source === '') {
        // Explicitly clearing the NAV binding is allowed: the security goes
        // back to the market quote providers.
        return [null, null];
    }
    if (!array_key_exists($source, fund_nav_providers())) {
        envelope_error('VALIDATION_ERROR', '不支援的基金淨值來源：' . $source, 422);
    }
    if ($code === '') {
        envelope_error('VALIDATION_ERROR', '使用基金淨值時必須填寫基金代號。', 422);
    }
    if (!fund_nav_code_is_valid($code)) {
        envelope_error('VALIDATION_ERROR', '基金代號格式不正確（僅限英數字與 . _ -）。', 422);
    }
    return [$source, $code];
}

/**
 * Validate an issuer-side fund identifier.
 *
 * Deliberately strict: the value is interpolated into a query string, so
 * only digits, dots, dashes and underscores are accepted. Anything else
 * is rejected before it can reach the issuer.
 */
function fund_nav_code_is_valid(string $navCode): bool
{
    return $navCode !== '' && strlen($navCode) <= 32
        && preg_match('/^[A-Za-z0-9._-]+$/', $navCode) === 1;
}

/**
 * Fetch NAV history for one 元大 fund unit.
 *
 * Endpoint: https://api.yuantafunds.com/ectranslation/api/trans
 *   FuncId=FundNAV  — daily NAV series for one fund id
 *   FuncId=FundList — full catalogue (191 funds, used for lookups)
 *
 * The issuer's own web front-end calls this endpoint with a fixed set of
 * common parameters; the API rejects the request when they are missing.
 * DeviceId is a per-client identifier — we generate a throwaway UUID per
 * request rather than persisting anything.
 *
 * @return array{items: array<int, array{date: string, nav: string}>}
 */
function yuanta_nav_history(string $navCode): array
{
    if (!fund_nav_code_is_valid($navCode)) {
        return ['items' => []];
    }

    $url = 'https://api.yuantafunds.com/ectranslation/api/trans?' . http_build_query([
        'APIType'     => 'EC2API',
        'CompanyName' => 'YUANTAFUNDS',
        'AppName'     => 'FundWeb',
        'PageName'    => '/myfund/information/' . rawurlencode($navCode),
        'Device'      => '4',
        'Platform'    => 'YUANTAFUND',
        'DeviceId'    => uuid(),
        'FuncId'      => 'FundNAV',
        'FundId'      => $navCode,
    ]);

    $payload = fund_nav_http_get_json($url);
    if (!is_array($payload) || (int)($payload['ResultCode'] ?? -1) !== 0) {
        return ['items' => []];
    }

    $nav = $payload['Data']['NAV'] ?? null;
    if (!is_array($nav)) {
        return ['items' => []];
    }

    $items = [];
    foreach ($nav as $row) {
        if (!is_array($row)) {
            continue;
        }
        $date = preg_replace('/[^0-9]/', '', (string)($row['NAV_DATE'] ?? ''));
        $value = $row['NAV_B'] ?? null;
        if ($date === '' || strlen($date) !== 8 || !is_numeric($value) || (float)$value <= 0) {
            continue;
        }
        $items[] = ['date' => $date, 'nav' => (string)$value];
    }

    return ['items' => $items];
}

/**
 * Look up 元大 fund metadata by fund id, ISIN or ticker.
 *
 * Uses the issuer's FuncId=FundList catalogue endpoint (191 rows) and
 * filters server-side, so the caller can offer a searchable picker in
 * Settings instead of asking the user to type a fund id.
 *
 * @return array<int, array{code: string, name: string, nav: string,
 *                        nav_date: string, isin: string, currency: string}>
 */
function yuanta_fund_catalogue(string $keyword = ''): array
{
    $url = 'https://api.yuantafunds.com/ectranslation/api/trans?' . http_build_query([
        'APIType'     => 'EC2API',
        'CompanyName' => 'YUANTAFUNDS',
        'AppName'     => 'FundWeb',
        'PageName'    => 'WELCOME',
        'Device'      => '4',
        'Platform'    => 'YUANTAFUND',
        'DeviceId'    => uuid(),
        'FuncId'      => 'FundList',
    ]);

    $payload = fund_nav_http_get_json($url);
    if (!is_array($payload) || (int)($payload['ResultCode'] ?? -1) !== 0) {
        return [];
    }

    $funds = $payload['Data']['FUND'] ?? null;
    if (!is_array($funds)) {
        return [];
    }

    $needle = mb_strtolower(trim($keyword));
    $out = [];
    foreach ($funds as $row) {
        if (!is_array($row)) {
            continue;
        }
        $code = (string)($row['FUND_ID'] ?? '');
        $name = (string)($row['FUND_SH_NM'] ?? '');
        $isin = (string)($row['ISINCODE'] ?? '');
        $ticker = (string)($row['STK_CD'] ?? '');
        if ($code === '') {
            continue;
        }
        if ($needle !== '') {
            $haystack = mb_strtolower($code . ' ' . $name . ' ' . $isin . ' ' . $ticker);
            if (!str_contains($haystack, $needle)) {
                continue;
            }
        }
        $out[] = [
            'code'     => $code,
            'name'     => $name,
            'nav'      => (string)($row['NAV'] ?? ''),
            'nav_date' => (string)($row['NAV_DATE'] ?? ''),
            'isin'     => $isin,
            'currency' => (string)($row['CRNCY_NM'] ?? ''),
        ];
    }

    return $out;
}

/**
 * Backfill the historical NAV series for NAV-priced securities.
 *
 * The issuer's FundNAV endpoint returns the whole published series in one
 * response, so the backfill is a single request per fund rather than one
 * per day. Rows are written with source='fund_nav' — the official published
 * value for that date — so the P&L backfill for market securities can
 * never overwrite them with a 'historical_import' row.
 *
 * @param array $securities rows carrying id, nav_source, nav_code, currency, user_id
 * @return array{imported: int, failed: array<int, array{symbol: string, reason: string}>}
 */
function pnl_backfill_fund_nav_history(PDO $pdo, int $userId, array $securities): array
{
    $providers = fund_nav_providers();
    $items = [];
    $failed = [];

    foreach ($securities as $security) {
        $source = trim((string)($security['nav_source'] ?? ''));
        $code = trim((string)($security['nav_code'] ?? ''));
        $symbol = (string)($security['symbol'] ?? '');
        if ($source === '' || $code === '') {
            continue;
        }
        if (!isset($providers[$source])) {
            $failed[] = ['symbol' => $symbol, 'reason' => 'Unknown NAV provider: ' . $source];
            continue;
        }
        if (!fund_nav_code_is_valid($code)) {
            $failed[] = ['symbol' => $symbol, 'reason' => 'Invalid NAV code'];
            continue;
        }
        $result = call_user_func($providers[$source], $code);
        $navItems = $result['items'] ?? [];
        if (!$navItems) {
            $failed[] = ['symbol' => $symbol, 'reason' => 'No NAV history for code ' . $code];
            continue;
        }
        foreach ($navItems as $navItem) {
            $items[] = [
                'security_id' => (string)$security['id'],
                'date'        => $navItem['date'],
                'open'        => $navItem['nav'],
                'high'        => $navItem['nav'],
                'low'         => $navItem['nav'],
                'close'       => $navItem['nav'],
                'volume'      => '0',
                'currency'    => (string)($security['currency'] ?? 'TWD'),
                'user_id'     => (int)$userId,
                'source'      => 'fund_nav',
            ];
        }
    }

    if (!$items) {
        return ['imported' => 0, 'failed' => $failed];
    }

    // Write the series in one transaction so a partially written history
    // cannot leave the P&L curve with holes.
    $persisted = persist_prices($pdo, $items);
    return [
        'imported' => (int)($persisted['updated'] ?? 0),
        'failed'   => array_merge($failed, $persisted['failed'] ?? []),
    ];
}

/**
 * Minimal HTTP GET + JSON decode with a hard timeout.
 *
 * Shared by the 元大 adapter only. No redirect following, an explicit
 * User-Agent, and a Referer matching the issuer's own site so the API
 * returns the same payload the public web front-end gets.
 */
function fund_nav_http_get_json(string $url): ?array
{
    if (!function_exists('curl_init')) {
        sh_log('error', 'fund_nav.fetch_error', ['code' => 'DEPENDENCY_MISSING']);
        return null;
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'User-Agent: stock_hold/2.5',
            'Referer: https://www.yuantafunds.com/',
        ],
    ]);
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    if ($raw === false || $status < 200 || $status >= 300) {
        sh_log('error', 'fund_nav.fetch_error', [
            'code' => 'HTTP_ERROR',
            'http_status' => $status,
            'curl_error' => $error,
        ]);
        return null;
    }
    $payload = json_decode($raw, true);
    if (!is_array($payload)) {
        sh_log('error', 'fund_nav.fetch_error', ['code' => 'INVALID_JSON']);
        return null;
    }
    return $payload;
}

/**
 * Fetch and store NAV prints for the NAV-priced securities of one user.
 *
 * Only the newest NAV print is persisted as a price row (source
 * 'fund_nav'); older prints stay available through the issuer's history
 * endpoint when the P&L backfill asks for them. This keeps `prices`
 * one-row-per-(security, date) — same shape as every other provider.
 *
 * @param array $securities rows carrying id, nav_source, nav_code, currency, user_id
 * @return array{updated: int, failed: array<int, array{symbol: string, reason: string}>}
 */
function fetch_fund_nav_quotes(PDO $pdo, array $securities): array
{
    $providers = fund_nav_providers();
    $items = [];
    $failed = [];

    foreach ($securities as $security) {
        $source = trim((string)($security['nav_source'] ?? ''));
        $code = trim((string)($security['nav_code'] ?? ''));
        $symbol = (string)($security['symbol'] ?? '');
        if ($source === '' || $code === '') {
            continue;
        }
        if (!isset($providers[$source])) {
            $failed[] = ['symbol' => $symbol, 'reason' => 'Unknown NAV provider: ' . $source];
            continue;
        }
        if (!fund_nav_code_is_valid($code)) {
            $failed[] = ['symbol' => $symbol, 'reason' => 'Invalid NAV code'];
            continue;
        }
        $result = call_user_func($providers[$source], $code);
        $navItems = $result['items'] ?? [];
        if (!$navItems) {
            $failed[] = ['symbol' => $symbol, 'reason' => 'No NAV published for code ' . $code];
            continue;
        }
        // Newest print first (the issuer returns the series newest-first).
        $latest = $navItems[0];
        $items[] = [
            'security_id' => (string)$security['id'],
            'date'        => $latest['date'],
            'open'        => $latest['nav'],
            'high'        => $latest['nav'],
            'low'         => $latest['nav'],
            'close'       => $latest['nav'],
            'volume'      => '0',
            'currency'    => (string)($security['currency'] ?? 'TWD'),
            'user_id'     => (int)($security['user_id'] ?? 0),
            'source'      => 'fund_nav',
        ];
    }

    if (!$items) {
        return ['updated' => 0, 'failed' => $failed];
    }

    // The web front controller defines persist_prices(), but the standalone
    // CLI intentionally does not load api/index.php (it would dispatch HTTP
    // and exit). Keep this provider usable from both entry points.
    $persisted = function_exists('persist_prices')
        ? persist_prices($pdo, $items)
        : fund_nav_persist_prices($pdo, $items);
    return [
        'updated' => (int)($persisted['updated'] ?? 0),
        'failed'  => array_merge($failed, $persisted['failed'] ?? []),
    ];
}

/**
 * CLI-safe price writer for NAV rows.
 *
 * This mirrors the price-source precedence used by the web writer: an
 * existing live or fund_nav row is never downgraded by a later import.
 */
function fund_nav_persist_prices(PDO $pdo, array $items): array
{
    $upsert = $pdo->prepare(
        'INSERT INTO prices '
        . '(id,security_id,date,open,high,low,close,volume,currency,created_at,user_id,source) '
        . 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?) '
        . 'ON CONFLICT(security_id,date) DO UPDATE SET '
        . 'user_id=excluded.user_id,open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close, '
        . 'volume=excluded.volume,currency=excluded.currency,created_at=excluded.created_at, '
        . 'source=CASE WHEN prices.source IN (\'live\',\'fund_nav\') THEN prices.source ELSE excluded.source END'
    );
    $updated = 0;
    $failed = [];
    foreach ($items as $item) {
        if (!is_array($item) || empty($item['security_id']) || empty($item['date']) || !isset($item['close'])) {
            $failed[] = ['item' => $item, 'reason' => 'security_id, date and close are required'];
            continue;
        }
        $close = decimal($item['close']);
        $upsert->execute([
            uuid(), $item['security_id'], $item['date'],
            decimal($item['open'] ?? $close), decimal($item['high'] ?? $close),
            decimal($item['low'] ?? $close), $close,
            decimal($item['volume'] ?? '0'),
            strtoupper((string)($item['currency'] ?? 'TWD')),
            now_sql(), (int)($item['user_id'] ?? 0), 'fund_nav',
        ]);
        $updated++;
    }
    return ['updated' => $updated, 'failed' => $failed];
}
