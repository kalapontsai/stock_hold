<?php
declare(strict_types=1);

/**
 * Stock_hold CLI backup tool.
 *
 * F-02 fix: backup moved off the HTTP surface. The .htaccess already denies
 * /cli over the web, so this script can only be reached from the server shell.
 *
 * Usage:
 *   php cli/backup.php
 *
 * Output:
 *   The created backup filename (e.g. stock_hold_20260924_183000.sqlite),
 *   printed on stdout. The file lives in runtime/backup/.
 */

require_once dirname(__DIR__) . '/api/bootstrap.php';

$backupDir = runtime_dir() . DIRECTORY_SEPARATOR . 'backup';
if (!is_dir($backupDir)) {
    if (!@mkdir($backupDir, 0770, true) && !is_dir($backupDir)) {
        fwrite(STDERR, "Failed to create backup directory: {$backupDir}\n");
        exit(1);
    }
}

$target = $backupDir . DIRECTORY_SEPARATOR . 'stock_hold_' . gmdate('Ymd_His') . '.sqlite';
$source = runtime_dir() . DIRECTORY_SEPARATOR . 'stock_hold.sqlite';

if (!is_file($source)) {
    fwrite(STDERR, "Database not found: {$source}\n");
    exit(1);
}

if (!@copy($source, $target)) {
    fwrite(STDERR, "Failed to copy {$source} to {$target}\n");
    exit(1);
}

echo basename($target) . "\n";
exit(0);
