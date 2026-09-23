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

### 2. API token（Agent/CLI 使用）

瀏覽器使用同源 session + CSRF；Agent 或 CLI mutation 才需要 `X-API-Token`。

不要把 token 寫入前端或 Git。可由 Apache `SetEnv STOCK_HOLD_API_TOKEN ...` 或主機安全環境變數注入。

### 3. 執行 migration

PHP CLI 可用時，在專案根目錄執行：

```powershell
php cli\migrate.php
```

WSL/Linux：

```bash
php cli/migrate.php
```

### 4. 載入示範資料（可選）

```bash
php cli/seed.php
```

正式資料匯入工具尚在遷移階段；不要將示範資料與正式資料混用。

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

設定頁的「報價更新」預設使用台灣證券交易所 MIS 行情來源，由 PHP cURL 在伺服器端抓取，不需要 API key；抓取結果會寫入 SQLite 的 `prices` 表。

1. 開啟「設定 → 報價更新」。
2. 選擇「台灣證交所 MIS」或「手動匯入」。
3. 設定更新間隔並儲存。
4. 按「立即更新全部持股」取得最新行情。

API 也可手動執行：

```bash
curl -X POST \
  -H "X-API-Token: $STOCK_HOLD_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"symbols":[]}' \
  http://localhost/stock_hold/api/v1/prices/batch-update
```

`symbols` 留空代表更新所有啟用中的標的；目前來源為台股交易所行情，非交易時段會取得交易所最後成交價。行情服務若暫時無法連線，既有價格不會被覆蓋。

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
- 不要把 `STOCK_HOLD_API_TOKEN` 寫進 JavaScript、HTML、README 或 Git。
- restore 前先備份；交易歷史使用 reversal，不直接刪除。
