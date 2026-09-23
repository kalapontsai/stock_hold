<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/bootstrap.php';
$pdo = db();
$version = '001-initial';
$sql = file_get_contents(dirname(__DIR__) . '/migrations/001-initial.sql');
if ($sql === false) {
    throw new RuntimeException('Migration file is not readable.');
}
$pdo->exec($sql);
$exists = $pdo->prepare('SELECT 1 FROM schema_migrations WHERE version=?');
$exists->execute([$version]);
if (!$exists->fetchColumn()) {
    $pdo->prepare('INSERT INTO schema_migrations(version, applied_at) VALUES(?,?)')->execute([$version, now_sql()]);
    echo "Applied {$version}\n";
} else {
    echo "Already up to date\n";
}
