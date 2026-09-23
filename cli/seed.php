<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/api/bootstrap.php';
$pdo = db();
$pdo->exec(file_get_contents(dirname(__DIR__) . '/migrations/001-initial.sql'));
$now = now_sql();
$account = $pdo->prepare('INSERT OR IGNORE INTO accounts(id,type,name,currency,broker,account_no,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
$account->execute(['acc-demo-bank','BANK','示範銀行','TWD',null,null,'ACTIVE',$now,$now]);
$account->execute(['acc-demo-broker','BROKER','示範券商','TWD','示範券商',null,'ACTIVE',$now,$now]);
$security = $pdo->prepare('INSERT OR IGNORE INTO securities(id,symbol,exchange,currency,name,type,sector,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
$security->execute(['sec-demo-2330','2330','TW','TWD','台積電','STOCK','半導體',1,$now,$now]);
echo "Seed complete\n";
