<?php
/**
 * flush.php — one-shot PHP opcache + LiteSpeed Cache purge.
 *
 * USAGE: drop this single file in webroot via FileZilla, then visit it once:
 *          https://tracker.elhomeo.com/flush.php
 *
 * It calls:
 *   1. opcache_reset()            — clears PHP opcache (compiled bytecode cache)
 *   2. lscache_purge_all()        — clears LiteSpeed Cache plugin (if loaded)
 *   3. clearstatcache()           — clears PHP stat cache so file mtimes re-read
 *
 * After this, PHP will recompile api/bootstrap.php on the next request and
 * serve the new security_headers() / verify_turnstile() / CSP from disk.
 *
 * DELETE THIS FILE (flush.php) AFTER RUNNING — it leaks server info and
 * leaves a cache-purge endpoint exposed otherwise.
 */
declare(strict_types=1);

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');

$lines = [];
$lines[] = '=== stock_hold cache flush @ ' . gmdate('Y-m-d\TH:i:s\Z') . ' ===';

// 1) PHP opcache
if (function_exists('opcache_reset')) {
    $ok = @opcache_reset();
    $lines[] = 'opcache_reset()  = ' . ($ok ? 'OK' : 'FAILED');
} else {
    $lines[] = 'opcache_reset()  = NOT AVAILABLE (opcache extension not loaded)';
}

// 2) LiteSpeed Cache (if module loaded)
if (function_exists('lscache_purge_all')) {
    $ok = @lscache_purge_all();
    $lines[] = 'lscache_purge_all() = ' . ($ok ? 'OK' : 'FAILED');
} else {
    $lines[] = 'lscache_purge_all() = NOT AVAILABLE (LiteSpeed Cache module not loaded in PHP)';
}

// 3) PHP stat cache (so subsequent mtime checks re-read disk)
clearstatcache(true);

if (function_exists('opcache_get_status')) {
    $status = @opcache_get_status(false);
    if (is_array($status)) {
        $lines[] = 'opcache_get_status:';
        $lines[] = '  opcache_enabled = ' . var_export($status['opcache_enabled'] ?? null, true);
        $lines[] = '  cache_full      = ' . var_export($status['cache_full'] ?? null, true);
        $lines[] = '  scripts_cached  = ' . count($status['scripts'] ?? []);
        $used = $status['memory_usage']['used_memory'] ?? null;
        $lines[] = '  memory_used     = ' . ($used !== null ? $used . ' bytes' : 'unknown');
    } else {
        $lines[] = 'opcache_get_status() returned non-array (opcache disabled?)';
    }
}

$lines[] = '';
$lines[] = 'Next steps:';
$lines[] = '  1. curl -I https://tracker.elhomeo.com/api/v1/health (expect new CSP + DENY + X-Stock-Hold-Debug)';
$lines[] = '  2. If LiteSpeed Cache plugin is enabled (separate from PHP opcache):';
$lines[] = '       cPanel → LiteSpeed Cache → Purge All (this PHP script cannot reach LiteSpeed\'s on-disk cache)';
$lines[] = '  3. Force-refresh browser (Ctrl+Shift+R) and try login again';
$lines[] = '  4. DELETE this file (flush.php) after confirming the cache is flushed';

echo implode("\n", $lines) . "\n";
