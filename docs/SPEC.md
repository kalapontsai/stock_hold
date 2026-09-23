# Stock Hold 規格書

> 個人股票與銀行資產記帳系統 — Apache-only 重編版
> 版本：v2.0-proposal
> 狀態：規劃中；本版只定義目標架構與驗收條件，尚未修改程式碼。
> 日期：2026-09-23（Asia/Taipei）

---

## 0. 本次架構決策

### 0.1 目標

系統維持單機、單人、local-first，但移除獨立的 Uvicorn/FastAPI server。整個 HTTP 系統由 Apache 提供：

```text
瀏覽器
  │ HTTP :80
  ▼
Apache + PHP module
  ├── 靜態前端：frontend/
  ├── API front controller：api/index.php
  └── SQLite：runtime/stock_hold.sqlite（不可被 Web 直接下載）
```

本版的「Apache-only」定義：

- 對外只有 Apache `port 80`。
- 不啟動 Uvicorn、FastAPI、Node server、PHP-FPM 或其他常駐 HTTP server。
- PHP 以 Apache module（Windows Apache 使用 PHP module）執行 request。
- PHP CLI 僅用於 migration、匯入、備份等離線維護，不是服務依賴。

### 0.2 為何不只是把 FastAPI 改成 port 80

Apache 與 FastAPI 同時綁定 port 80 會衝突；保留 FastAPI 則仍需要第二個 process 與 reverse proxy，沒有達到 Apache-only。Python CGI/WSGI 也會讓每次 request 啟動 Python，並保留目前 async ORM、venv 與部署複雜度，因此不採用。

### 0.3 技術選型（本版定案）

| 層 | 選擇 | 原因 |
|---|---|---|
| HTTP/Web | Apache 2.4 | 已有 port 80 與站點根目錄 |
| Server runtime | PHP 8.2+ Apache module | 不需要獨立 application server |
| DB driver | PDO SQLite | PHP 原生、交易與 prepared statement 完整 |
| DB | SQLite 3 + WAL | 單人單機、資料可攜、維運簡單 |
| Frontend | 現有 zero-build HTML/CSS/JS | 不引入 Node build server |
| API | PHP front controller + JSON envelope | 保留 `/stock_hold/api/v1/*` 公開契約 |
| 外部資料 | PHP cURL + skill adapter | 同步、可重試、可記錄的 job |
| 排程 | Windows Task Scheduler 或手動 endpoint | 不依賴常駐 scheduler process |

### 0.4 明確不做

- 不執行真實下單。
- 不做雲端服務、多使用者或 multi-tenant。
- 不做自動交易決策。
- 不做即時報價推送。
- 不把 SQLite、備份、`.env`、log 或 migration 原始檔放在可直接下載的 Web root。

## 1. 部署與檔案邊界

### 1.1 公開路徑

- Windows 專案根：`D:\docker-volumn\ubuntu-apache2\html\stock_hold`
- Apache URL：`http://localhost/stock_hold/`
- API URL：`http://localhost/stock_hold/api/v1/`
- Apache 對外 port：`80`
- 不存在 `:8000` backend port。

### 1.2 建議目錄

```text
stock_hold/                         # Apache document root 下的公開專案
├── frontend/                       # 可公開讀取的頁面與靜態資源
├── api/
│   ├── index.php                   # 唯一 API front controller
│   ├── bootstrap.php               # 設定、PDO、session、response
│   ├── routes.php                  # method + path route table
│   ├── controllers/                # HTTP 輸入輸出
│   ├── services/                   # 損益、持倉、對帳、維護邏輯
│   ├── repositories/               # PDO prepared statements
│   └── skills/                     # 外部資料 adapter
├── migrations/                     # 版本化 SQL；由 CLI 執行
├── cli/                            # migration、seed、import、backup 指令
├── docs/                           # 規格與操作文件
└── .htaccess                       # rewrite、禁止敏感檔案下載

runtime/                            # 建議放在 document root 外
├── stock_hold.sqlite
├── backup/
├── logs/
└── secrets/                        # token/設定，權限限制
```

若受限於既有掛載，只能把 `runtime/` 放在專案內，Apache 必須明確禁止存取：

```apache
<Directory "D:/docker-volumn/ubuntu-apache2/html/stock_hold/runtime">
    Require all denied
</Directory>
```

優先方案仍是將 runtime 搬到 `D:\docker-volumn\ubuntu-apache2\runtime\stock_hold`。

### 1.3 Apache request flow

```text
/stock_hold/frontend/*.html       → 靜態檔案
/stock_hold/api/v1/*              → api/index.php
/stock_hold/runtime/*             → 403
/stock_hold/.env / *.sqlite       → 403
```

Apache rewrite 必須保留原始 `PATH_INFO` 或將 path/query 交給 front controller；API 不依賴 Apache ProxyPass。

## 2. 領域模型與資料規則

保留目前已定義的八個核心實體，先不刪除重建資料模型：

| 實體 | 用途 | 關鍵欄位 |
|---|---|---|
| `accounts` | 銀行/券商帳戶 | id, type, name, currency, broker, account_no, status |
| `securities` | 股票/ETF/基金 | id, symbol, exchange, currency, name, type, sector |
| `transactions` | 交易與現金異動 | id, account_id, security_id, txn_date, type, qty, price, fees, fx_rate, note |
| `positions` | 由交易衍生的持倉快照 | account_id, security_id, qty, avg_cost, realized_pl |
| `prices` | 歷史與最新價格 | security_id, date, OHLCV, currency |
| `dividends` | 配息紀錄 | security_id, ex_date, pay_date, amount_per_share, currency |
| `fx_rates` | 匯率快照 | base_ccy, quote_ccy, date, rate |
| `cash_balances` | 對帳單餘額 | account_id, snapshot_date, balance, currency |

### 2.1 列舉與一致性

- `AccountType`：`BANK`、`BROKER`。
- `AccountStatus`：`ACTIVE`、`INACTIVE`；前端一律以 API enum 為準，不使用另一套 `active/disabled` 字串。
- `SecurityType`：`STOCK`、`ETF`、`FUND`。
- `TransactionType`：`BUY`、`SELL`、`DIVIDEND`、`DEPOSIT`、`WITHDRAW`、`TRANSFER_IN`、`TRANSFER_OUT`、`FEE`、`SPLIT`、`MERGER`。
- 金額與數量以 SQLite NUMERIC/字串 Decimal 交換，不使用 JavaScript binary float 作為儲存值。
- 所有資料庫時間使用 UTC；UI 顯示轉 Asia/Taipei。

### 2.2 計算規則

- BUY 使用加權平均成本。
- SELL 不改變剩餘持倉平均成本，依賣出時成本計算 realized P/L。
- Unrealized P/L = `(current_price - avg_cost) × qty`。
- 多幣別結果以最新 FX rate 轉換到 base currency，預設 TWD。
- 每次交易 mutation 與 position rebuild 必須在同一個 SQLite transaction 內完成。

### 2.3 資料刪除策略

- 交易歷史不可由 UI 硬刪；修正採 reversal/adjustment transaction。
- 帳戶與標的使用停用（`INACTIVE`/`is_active=false`），保留關聯資料。
- database restore 只允許 admin/本機維護流程，並在操作前建立自動備份。

## 3. API v2 契約

### 3.1 統一 envelope

```json
{
  "status": "ok",
  "data": {},
  "error": null,
  "meta": {"request_id": "uuid", "ts": "2026-09-23T10:00:00Z"}
}
```

錯誤使用同一 envelope，HTTP status 必須反映錯誤類型：400 validation、401 auth、403 permission、404 not found、409 conflict、500 internal error。

### 3.2 路由原則

保留 `/api/v1` 路徑以降低前端改動，所有 mutation 使用 body 的 `id`：

```text
GET  /api/v1/accounts
POST /api/v1/accounts/create
POST /api/v1/accounts/update
POST /api/v1/accounts/disable

GET  /api/v1/securities
POST /api/v1/securities/create
POST /api/v1/securities/update
POST /api/v1/securities/disable

GET  /api/v1/transactions
POST /api/v1/transactions/create
POST /api/v1/transactions/update
POST /api/v1/transactions/reverse

GET  /api/v1/holdings
GET  /api/v1/prices
GET  /api/v1/dividends
GET  /api/v1/fx/rates
GET  /api/v1/dashboard/summary
GET  /api/v1/dashboard/allocation
GET  /api/v1/reports/realized
GET  /api/v1/reports/dividends
GET  /api/v1/schema
GET  /api/v1/schema/{entity}
POST /api/v1/maintenance/reconcile
POST /api/v1/maintenance/backup
POST /api/v1/maintenance/restore
POST /api/v1/prices/batch-update
GET  /api/v1/settings/quotes
POST /api/v1/settings/quotes
POST /api/v1/fx/refresh
POST /api/v1/skills/{skill}/run
```

### 3.3 List response

所有 list API 統一回傳：

```json
{
  "status": "ok",
  "data": {"items": [], "pagination": {"total": 0, "page": 1, "page_size": 25, "total_pages": 1}},
  "error": null,
  "meta": {}
}
```

前端 API client 必須只在一處解包 `data.items`，頁面不可自行猜測 mock array 或 backend object。

### 3.4 認證與 CSRF

- Apache 綁定 localhost 或由 Windows Firewall 限制為 localhost，不假設「看到 127.0.0.1 就可信」。
- Browser UI 使用同源 session cookie + CSRF token；cookie 設 `HttpOnly`、`SameSite=Lax`。
- Agent/CLI 使用 `X-API-Token`，token 從 Apache/PHP runtime 外部設定取得，不寫入前端。
- 所有 mutation 都必須通過 CSRF 或 API token；GET 不等於可公開給 LAN。
- `/schema`、帳戶與交易資料預設僅 localhost 可讀。
- restore、token rotate、skill run 需要 admin/agent 權限，restore 必須帶明確 `confirm`。

## 4. Apache/PHP runtime 規格

### 4.1 必要元件

- Apache 2.4
- PHP 8.2 或更新版本，Apache module
- PHP extensions：`pdo_sqlite`、`json`、`curl`、`mbstring`、`openssl`
- SQLite 3.35 或更新版本，支援 WAL 與 transaction
- Windows Task Scheduler（可選，用於每日更新與每週備份）

不需要 Python、venv、FastAPI、Uvicorn、Node.js 或 Composer 才能啟動網站。

### 4.2 Front controller

`api/index.php` 負責：

1. 設定 error handler 與 request id。
2. 驗證 HTTP method、path、JSON body size。
3. 啟用 session/CSRF 或驗證 API token。
4. 建立 PDO SQLite connection，設定 `foreign_keys=ON`、WAL 與 busy timeout。
5. 將 request dispatch 至 controller/service。
6. 統一輸出 envelope 與安全錯誤訊息。

Controller 不得直接組 SQL；所有 SQL 必須由 repository 使用 prepared statement 執行。

### 4.3 Migration 與 seed

- migration 以遞增版本 SQL 儲存於 `migrations/`。
- `schema_migrations` table 記錄已執行版本。
- Apache request 不自動變更 schema。
- migration、seed、資料匯入由 PHP CLI 指令執行，並要求先備份。

## 5. Skills 與外部資料

每個 skill 改為 PHP adapter 或受控 CLI job，統一介面 `run(array $params): array`。

要求：

- allowlist 只允許已註冊 skill，不可由 URL 任意載入檔案。
- 外部 URL 只能使用 HTTPS allowlist。
- 設定 connect timeout、overall timeout、重試次數與錯誤記錄。
- 外部資料只在 job transaction 完成驗證後寫入。
- UI 只顯示最後成功/失敗時間，不在 request 中無限等待外部服務。

## 6. 備份、還原與排程

- 備份檔放在 runtime 外部目錄，不可由 URL 下載。
- backup 使用 SQLite checkpoint/一致性檢查後複製，檔名由 server 產生。
- restore 禁止使用者提供任意 filesystem path；只能選擇 runtime backup allowlist 中的檔案。
- restore 前自動產生 pre-restore backup；失敗時保留原資料並回報錯誤。
- Task Scheduler 可呼叫 `php cli/maintenance.php prices`、`backup`、`reconcile`。
- 排程失敗寫入本地 log，UI 提供最後執行狀態。

## 7. 前端需求

- 保留既有 dashboard、transactions、holdings、reports、settings 頁面。
- 移除 `?mock=1` 作為 production data source 的可能性；mock 只能由開發設定開啟。
- 所有儲存按鈕必須等待 API 成功後才顯示成功 toast。
- API error 必須顯示可理解的錯誤，不得 `.catch(() => [])` 靜默當成空資料。
- UI status 採 API enum；不得同時使用 `active/disabled` 與 `ACTIVE/INACTIVE`。
- 新增帳戶的驗收條件：POST 成功、重新 GET 可見、重新整理頁面仍可見。

## 8. 測試與驗收

### 8.1 單元與整合測試

- PHP service/repository 測試覆蓋平均成本、SELL、股利、FX、對帳與 restore safety。
- API integration test 直接呼叫 Apache/PHP endpoint，使用臨時 SQLite，不依賴 Uvicorn。
- 每個 mutation 測試 200、400、401/403、409 與 transaction rollback。
- 前端測試確認 API response、表單 validation、錯誤 toast、重新載入後資料存在。
- 目標覆蓋率：核心 domain/service ≥ 80%；API route ≥ 70%。

### 8.2 上線驗收

```text
GET  http://localhost/stock_hold/                         200
GET  http://localhost/stock_hold/api/v1/health            200
GET  http://localhost/stock_hold/api/v1/accounts          200
POST http://localhost/stock_hold/api/v1/accounts/create   200 + persisted
GET  http://localhost/stock_hold/api/v1/accounts          contains created row
GET  http://localhost/stock_hold/runtime/stock_hold.sqlite 403
GET  http://localhost/stock_hold/.env                     403/404
```

並確認 Apache 是唯一 port 80 listener，沒有 Uvicorn/FastAPI background process，SQLite 可正常 backup/restore。

## 9. 實作狀態與維運順序

### Phase 0：凍結與盤點（已完成）

1. 確認 Apache-only 方向，舊 Python runtime 不列入發行內容。
2. 保留本機 runtime 資料，不將 SQLite、backup、log 或帳號資料提交到 Git。
3. 建立 API route matrix，逐一對應現有 frontend call site。
4. 確認 Apache PHP module、PDO SQLite、curl extension 與 localhost binding。

### Phase 1：Apache/PHP skeleton（已完成）

1. 建立 `api/index.php`、bootstrap、router、response envelope。
2. 建立 runtime 外部目錄與 Apache deny rules。
3. 建立 migration runner、schema version table、health endpoint。
4. 先完成 `GET /health`、`GET /schema`、`GET /accounts`。

### Phase 2：資料層與核心 domain（已完成）

1. 將現有八個 model 對應成 SQLite migration。
2. 以 PDO repository 重寫 accounts、securities、transactions。
3. 將平均成本、realized/unrealized P/L、FX、reconcile 移為純 PHP service。
4. 以 transaction/rollback 測試確認 position rebuild 原子性。

### Phase 3：前端接線（已完成）

1. 保留頁面與樣式，重寫單一 API client adapter。
2. 統一 list response、enum、error handling。
3. 接通帳戶/標的/交易 CRUD。
4. 完成新增帳戶的持久化 E2E 驗收。

### Phase 4：報表、維護與報價

1. 補 dashboard、reports、dividend、price、FX endpoint。
2. 補 backup/restore、import、reconcile。
3. 以 PHP cURL adapter 連接台灣證交所 MIS，報價寫入 `prices`。
4. Settings 提供報價來源、啟用、間隔與立即更新選項。

### Phase 5：安全與上線

1. localhost-only、session cookie、CSRF、API token、request size limit。
2. 檢查 runtime、`.env`、SQLite、backup 不可被下載。
3. 執行 migration、匯入、backup/restore、權限與錯誤情境測試。
4. 最後才更新 README 與 Apache site configuration。

## 10. 發行內容決策

### 採用：保留資料模型與前端，使用 Apache/PHP runtime

- 保留：八個 domain entities、計算規則、wireframe、design tokens、頁面資訊架構、API 路徑概念。
- 使用：`api/` 的 PHP front controller、PDO SQLite、session/CSRF 與 API token。
- 前端只改 API adapter、錯誤處理與必要 endpoint 呼叫。
- 優點：保留既有 domain 知識與 UI 投資，風險較小，且可逐階段驗證。

舊 Python backend、虛擬環境、cache、匯入 log 與含本機/帳號資訊的歷史報告已移出發行目錄；本機帳務資料仍留在 `runtime/`，並由 `.gitignore` 排除。

## 11. 變更紀錄

| 版本 | 日期 | 變更 |
|---|---|---|
| v1.0 | 2026-09-23 | FastAPI + Uvicorn + SQLAlchemy async baseline |
| v2.0-proposal | 2026-09-23 | 改為 Apache-only + PHP module + PDO SQLite；只完成規格與遷移計畫，尚未修改 code |
