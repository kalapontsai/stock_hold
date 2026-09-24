<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/bootstrap.php';
$pdo = db();

$files = glob(dirname(__DIR__) . '/migrations/[0-9][0-9][0-9]-*.sql') ?: [];
sort($files, SORT_STRING);
foreach ($files as $file) {
    $version = pathinfo($file, PATHINFO_FILENAME);
    $exists = $pdo->prepare('SELECT 1 FROM schema_migrations WHERE version=?');
    $exists->execute([$version]);
    if ($exists->fetchColumn()) {
        continue;
    }
    $sql = file_get_contents($file);
    if ($sql === false) {
        throw new RuntimeException("Migration file is not readable: {$file}");
    }
    $pdo->beginTransaction();
    try {
        $pdo->exec($sql);
        $pdo->prepare('INSERT INTO schema_migrations(version, applied_at) VALUES(?,?)')->execute([$version, now_sql()]);
        $pdo->commit();
        echo "Applied {$version}\n";
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

echo "Migration check complete\n";
