# Stock Hold

個人股票、券商與銀行資產記帳系統。現行版本採 **Apache-only** 架構：Apache 在 port 80 提供靜態前端與 PHP API，不需要 Uvicorn、FastAPI、PHP-FPM 或 Node server。

## 架構

```text
瀏覽器 :80
   ↓
Apache + PHP module
   ├─ frontend/ 靜態頁面
   ├─ api/index.php PHP API front controller
   └─ runtime/stock_hold.sqlite SQLite
```

公開網址：`http://localhost/stock_hold/`（根目錄直接進入 Dashboard）

API：`http://localhost/stock_hold/api/v1/`

登入：首次使用請開啟 `/stock_hold/frontend/login.html` 註冊；後續請使用帳號或 Email 登入。業務 API 需要同源 Session，瀏覽器 mutation 需 CSRF token；Agent/CLI mutation 使用各使用者專屬 `X-API-Token`（參見 §2），且仍會套用使用者資料範圍。

## 必要環境

- Apache 2.4
- PHP 8.2+ Apache module
- PHP extensions：`pdo_sqlite`、`json`、`curl`、`mbstring`、`openssl`
- SQLite 3

不需要 Python/venv 才能執行網站。舊版 Python backend 不屬於目前 Apache-only 發行內容。

## 安裝與初始化

### 1. Apache PHP 設定

將專案放在：

```text
D:\docker-volumn\ubuntu-apache2\html\stock_hold
```

確認 Apache 已載入 PHP module，且 document root 可讀取此目錄。專案根目錄的 `.htaccess` 會：

- 將 `/api/v1/*` 導向 `api/index.php`
- 禁止下載 `runtime/`、`migrations/`、`.env` 與 SQLite 檔案
- 關閉目錄瀏覽

若 Apache 未允許 `.htaccess`，VirtualHost 必須開啟：

```apache
<Directory "D:/docker-volumn/ubuntu-apache2/html/stock_hold">
    AllowOverride FileInfo Limit
    Require all granted
</Directory>
```

建議將 runtime 放在 document root 外：

```apache
SetEnv STOCK_HOLD_RUNTIME_DIR "D:/docker-volumn/ubuntu-apache2/runtime/stock_hold"
<Directory "D:/docker-volumn/ubuntu-apache2/runtime/stock_hold">
    Require all denied
</Directory>
```

若暫時使用專案內的 `runtime/`，現有 `.htaccess` 會禁止 HTTP 讀取。

### 2. API token（Per-user / Agent / CLI 使用）

**Per-user token（多租戶，migration 007+）：** 每個使用者進入「設定 → API Token」來生成 / 列表 / 撤銷。Token 僅顯示一次，保存為 salted SHA-256 hash + 前 8 字元 prefix。

- 瀏覽器 mutation：session + CSRF（token 不需）
- Agent / CLI / 腳本 mutation：取得該使用者的 token 後以 `-H "X-API-Token: ***"` 來呼叫，仍套用 user_id 隔離的資料範圍
- 舊版全域 `STOCK_HOLD_API_TOKEN` 環境變數已退役，`SetEnv STOCK_HOLD_API_TOKEN ...` 不再授予任何使用者權限。請每個使用者（含管理員）在「設定 → API Token」產生自己的 token，並更新外部整合設定。

### 3. 執行 migration

PHP CLI 可用時，在專案根目錄執行：

```powershell
php cli\migrate.php
```

WSL/Linux：

```bash
php cli/migrate.php
```

Migration 會依檔名順序套用。`002-users-and-tenant-columns.sql` 會建立使用者與租戶欄位；既有單人資料會在第一個成功註冊的帳號建立時歸屬該帳號。公開註冊預設只允許建立第一個帳號，可用 `STOCK_HOLD_ALLOW_REGISTRATION=1` 開放後續註冊。

### 4. 載入示範資料（可選）

```bash
php cli/seed.php
```

正式資料匯入工具尚在遷移階段；不要將示範資料與正式資料混用。

### 5. 備份與還原（CLI）

F-02 後，備份與還原不再走 HTTP；改為在伺服器 shell 執行：

```bash
# 備份（輸出新檔名至 stdout；檔案位於 runtime/backup/）
php cli/backup.php

# 還原指定備份；自動產生 safety backup
php cli/restore.php --file=stock_hold_20260924_120000.sqlite --confirm
```

## 使用系統

開啟：

```text
http://localhost/stock_hold/
```

根目錄現在就是正式操作入口；`frontend/` 保留前端 HTML、CSS 與 JavaScript 原始檔案，不需要先進入 `/frontend/`。

主要頁面：

| 頁面 | URL |
|---|---|
| 總覽 | `/stock_hold/` |
| 交易 | `/stock_hold/frontend/transactions.html` |
| 持倉 | `/stock_hold/frontend/holdings.html` |
| 報表 | `/stock_hold/frontend/reports.html` |
| 設定 | `/stock_hold/frontend/settings.html` |

### 新增帳戶

1. 開啟「設定」。
2. 在「帳戶」區塊按「新增」。
3. 填入類型、名稱、幣別與帳號。
4. 按「儲存」。
5. 成功後頁面會重新載入，帳戶仍會出現在清單中。

帳戶停用會保留交易紀錄，不會硬刪除資料。

### 更新最新報價

設定頁的「報價更新」預設使用台灣證券交易所 MIS 行情來源，由 PHP cURL 在伺服器端抓取，不需要 API key；抓取結果會寫入 SQLite 的 `prices` 表。每次更新會保存今日最新報價與昨日收盤價，並清理更早的市價資料。

1. 開啟「設定 → 報價更新」。
2. 選擇「台灣證交所 MIS」或「手動匯入」。
3. 按「立即更新全部持股」取得今日最新報價與昨日收盤價。

API 也可手動執行：

```bash
curl -X POST \
  -H "X-API-Token: $STOCK_HOLD_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"symbols":[]}' \
  http://localhost/stock_hold/api/v1/prices/batch-update
```

`symbols` 留空代表更新所有啟用中的標的；目前來源為台股交易所行情，非交易時段會取得交易所最後成交價。行情服務若暫時無法連線，既有價格不會被覆蓋。每個標的只保留今日與昨日兩筆市價資料，以降低 SQLite 儲存量。

### 總覽自動計算欄位

總覽頁的三個主要數字由 `GET /api/v1/dashboard/summary` 產生，計算實作位於 `api/index.php` 的 `/dashboard/summary` 路由。金額目前以資料庫儲存值計算；股票市值使用 `prices.close` 的最新一筆價格，現金則取現金異動交易的 `transactions.amount` 加總。

| 欄位 | 公式（目前實作） | 主要資料來源 |
|---|---|---|
| **總資產** | `最新市值 + 現金餘額` | `positions.qty × prices.close`；`transactions.amount`（`security_id IS NULL`） |
| **今日損益** | `Σ[持倉數量 × (最新收盤價 − 前一交易日收盤價)]` | `positions.qty`、`prices.close`；前一交易日取 `prices.date < 今天` 的最新一筆 |
| **未實現損益** | `Σ[持倉數量 × (最新收盤價 − 平均成本)]` | `positions.qty`、`positions.avg_cost`、`prices.close` |

補充規則：

- 只計算目前 `qty > 0` 的持倉，且每個使用者只讀取自己的資料。
- 今日有買進、賣出或其他交易的「帳戶＋標的」組合，今日損益會排除該組合，避免把當日交易量誤當成價格損益。
- 「最新收盤價」與「昨日收盤價」均從 `prices` 表讀取；沒有價格時以 `0` 計算。價格更新來源與操作方式見上節。
- 百分比欄位另以今日損益除以前一日持倉市值、或以損益除以成本基礎計算；沒有正的分母時顯示 `0%`。
- 目前 API 端的總覽加總未另套用 `fx_rates` 匯兌；若不同幣別資料混用，請先確認各筆金額的儲存幣別與報價資料一致。

## API 檢查

```bash
curl http://localhost/stock_hold/api/v1/health
curl http://localhost/stock_hold/api/v1/accounts
curl http://localhost/stock_hold/api/v1/securities
curl http://localhost/stock_hold/api/v1/holdings
```

新增帳戶：

```bash
curl -X POST \
  -H "X-API-Token: $STOCK_HOLD_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"BANK","name":"測試帳戶","currency":"TWD"}' \
  http://localhost/stock_hold/api/v1/accounts/create
```

所有 API 回應使用：

```json
{
  "status": "ok",
  "data": {},
  "error": null,
  "meta": {"request_id": "...", "ts": "..."}
}
```

## 備份

可由設定頁或 API 執行備份。CLI/排程整合完成前，也可以備份 runtime 目錄中的 SQLite 檔案，但必須先停止寫入操作。

```bash
curl -X POST \
  -H "X-API-Token: $STOCK_HOLD_API_TOKEN" \
  http://localhost/stock_hold/api/v1/maintenance/backup
```

備份檔不可放在公開 Web root，亦不可由使用者直接提供任意 filesystem path 進行 restore。

## Mock 模式

前端仍保留開發用 mock fixture：

```text
http://localhost/stock_hold/frontend/settings.html?mock=1
```

Mock 資料只存在瀏覽器記憶體，不會寫入 SQLite；正式環境不得依賴 mock。

## 排錯

### API 回傳 404

確認 Apache `.htaccess` 已生效，且 VirtualHost 有 `AllowOverride FileInfo Limit`。Apache-only 架構不需要設定 ProxyPass，也不需要啟動 port 8000。

### API 回傳 500 / database error

確認已執行：

```bash
php cli/migrate.php
```

並確認 Apache/PHP 對 runtime 目錄有讀寫權限。

### 新增帳戶後沒有出現

在瀏覽器 Network 確認：

```text
GET  /stock_hold/api/v1/auth/session     → 200
POST /stock_hold/api/v1/accounts/create  → 201/200
GET  /stock_hold/api/v1/accounts         → 200
```

若 POST 是 401，檢查 CSRF session 或 Agent token；若是 404，檢查 Apache rewrite；若是 500，檢查 migration 與 runtime 權限。

## 開發檔案

```text
api/                 PHP runtime 與 API
migrations/          SQLite schema migrations
cli/                 migration/seed/maintenance CLI
frontend/            HTML/CSS/JavaScript
runtime/             本機資料（不可公開下載）
docs/SPEC.md         Apache-only v2 規格
demo/                完全脫敏的示範輸入資料
```

## 安全注意事項

- 不要公開 Apache 到 LAN/WAN，除非另行配置 TLS、認證與防火牆。
- 不要將 `runtime/stock_hold.sqlite`、backup、token 或 log 放入公開下載路徑。
- 不要把任何 token（含使用者 API token、STOCK_HOLD_INIT_TOKEN、TURNSTILE SECRET）寫進 JavaScript、HTML、README 或 Git。
- restore 前先備份；交易歷史使用 reversal，不直接刪除。
