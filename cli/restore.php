<?php
declare(strict_types=1);

/**
 * Stock_hold CLI restore tool.
 *
 * F-02 fix: restore moved off the HTTP surface. The .htaccess already denies
 * /cli over the web, so this script can only be reached from the server shell.
 *
 * Usage:
 *   php cli/restore.php --file=<name> --confirm
 *
 * <name> must match the strict pattern ^stock_hold_[0-9]{8}_[0-9]{6}\.sqlite$.
 * A safety copy of the current SQLite is written next to the restored backup
 * before the swap.
 *
 * Output:
 *   safety_backup=<name> on stdout.
 */

require_once dirname(__DIR__) . '/api/bootstrap.php';

$args = getopt('', ['file::', 'confirm']);
if (!isset($args['file']) || $args['file'] === '' || !isset($args['confirm'])) {
    fwrite(STDERR, "Usage: php cli/restore.php --file=<name> --confirm\n");
    exit(2);
}

$name = basename((string)$args['file']);
if (!preg_match('/^stock_hold_[0-9]{8}_[0-9]{6}\.sqlite$/', $name)) {
    fwrite(STDERR, "Invalid backup file name: {$name}\n");
    exit(2);
}

$backupDir = runtime_dir() . DIRECTORY_SEPARATOR . 'backup';
$source = $backupDir . DIRECTORY_SEPARATOR . $name;
if (!is_file($source)) {
    fwrite(STDERR, "Backup file not found: {$source}\n");
    exit(3);
}

$current = runtime_dir() . DIRECTORY_SEPARATOR . 'stock_hold.sqlite';
$safety = $backupDir . DIRECTORY_SEPARATOR . 'stock_hold_before_restore_' . gmdate('Ymd_His') . '.sqlite';

if (!@copy($current, $safety)) {
    fwrite(STDERR, "Failed to create safety backup\n");
    exit(4);
}

if (!@copy($source, $current)) {
    fwrite(STDERR, "Failed to restore from {$source}\n");
    exit(5);
}

echo 'safety_backup=' . basename($safety) . "\n";
exit(0);
