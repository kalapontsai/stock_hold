<?php
declare(strict_types=1);

/**
 * Stock_hold CLI — log retention sweep.
 *
 * Explicit counterpart to the 1/100 probabilistic cleanup that sh_log() does
 * on every write. Use this from cron or by hand to force a sweep without
 * waiting for the next random write to hit the threshold.
 *
 * Retention is governed by STOCK_HOLD_LOG_RETENTION_DAYS (default 30).
 *
 * Usage:
 *   php cli/log-cleanup.php
 *
 * Output (stdout):
 *   Retention: N days
 *   Cutoff date: YYYY-MM-DD
 *   Deleted: K files
 *   Kept: M files
 *
 * Exit codes:
 *   0 — success (always — even if no files matched, this script doesn't error)
 *   1 — log directory could not be created/inspected (operator action needed)
 */

require_once dirname(__DIR__) . '/api/bootstrap.php';

$dir = runtime_dir() . DIRECTORY_SEPARATOR . 'log';
$retention = max(1, (int)(env_value('STOCK_HOLD_LOG_RETENTION_DAYS') ?: '30'));
$cutoff = gmdate('Y-m-d', time() - $retention * 86400);

if (!is_dir($dir)) {
    if (!@mkdir($dir, 0770, true) && !is_dir($dir)) {
        fwrite(STDERR, "Failed to create log directory: {$dir}\n");
        exit(1);
    }
    // Fresh directory, nothing to clean.
    echo "Retention: {$retention} days\n";
    echo "Cutoff date: {$cutoff}\n";
    echo "Deleted: 0 files\n";
    echo "Kept: 0 files\n";
    exit(0);
}

$files = glob($dir . DIRECTORY_SEPARATOR . 'stock_hold.*.log') ?: [];
$deleted = 0;
$kept = 0;
foreach ($files as $file) {
    $base = basename($file);
    if (!preg_match('/^stock_hold\.(\d{4}-\d{2}-\d{2})\.log$/', $base, $m)) {
        // Unrecognized file name — leave it alone.
        $kept++;
        continue;
    }
    if ($m[1] < $cutoff) {
        if (@unlink($file)) {
            $deleted++;
        } else {
            fwrite(STDERR, "Failed to delete: {$file}\n");
            $kept++;
        }
    } else {
        $kept++;
    }
}

echo "Retention: {$retention} days\n";
echo "Cutoff date: {$cutoff}\n";
echo "Deleted: {$deleted} files\n";
echo "Kept: {$kept} files\n";
exit(0);