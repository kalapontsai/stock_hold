# Changelog

本檔記錄 stock_hold 的所有重要變更。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/),版本遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [2.4.1] - 2026-10-13

### Fixed
- **Settings 損益警示輸入框無法儲存「連續下跌 N 個交易日」**（`frontend/js/pages/settings.js`）
  - Root cause: 2.4.0 把讀取改成 `s.consecutive_threshold`,但 server `GET /settings/pnl-alerts` 從頭到尾就只回 `consecutive_down_days`(legacy storage key,user-tuned 門檻,跟 alert trigger 共用同一個值),所以 input 永遠拿到 `undefined` → 顯示空。
  - Save 端沒改,POST 還是送對的 `consecutive_down_days`,所以 db 實際有寫入,但下次 reload input 就被清空,造成「設了等於沒設」的 UX bug。
  - Fix: 讀寫統一用 `consecutive_down_days`(對齊 server schema,`api/index.php:1630` GET + `:1638` POST),並在兩處加上註解說明 storage key 跟 POST contract key 的一致性。
  - Bump `STOCK_HOLD_VERSION` → 2.4.1(`api/bootstrap.php`)。

## [2.4.0] - 2026-10-12

### Added
- **FinMind v4 報價來源**（`api/index.php` + `api/_pnl_history.php` + 前端）
  - 新 provider `finmind`:台股完整歷史 (2010+),免費 token 即可使用 TaiwanStockPrice dataset。
  - Token 儲存沿用既有 `extension_api_keys` (AES-256-CBC),`ALLOWED_EXTENSION_PROVIDERS` 加 `finmind_token`。
  - 即時報價: `fetch_finmind_quotes(PDO, userId, securities)` — 1 個 symbol 1 個 HTTP call,跟 yahoo / twse_mis 同樣的 keep_dates 清理邏輯。
  - 歷史補入: `pnl_backfill_finmind(PDO, userId, securities, fromIso, toIso)` — 1 個 symbol 1 個 range call,200ms polite sleep。Free tier 600 req/hr,我們 8 個 symbol × 365 天 = 8 reqs 遠在內。
  - 與 `pnl.historical.max_lookback_days` 走同樣設定;只補「今天以前」(嚴格 `< todayIso`)。
  - 自動加進 `pnl_backfill_history` dispatch,順 `quotes.provider` 自動生效。
  - TW-only 覆蓋:FinMind 免費 tier 不支援美股 / 港股 / 日股。非 TW symbol 會被記為 `failed: finmind_tw_only` 而不跳出錯誤。
  - **SSRF 防護**:硬編 host `https://api.finmindtrade.com`,無 `CURLOPT_FOLLOWLOCATION`,只有 query 參數 + token (使用者輸入的 token,不是 user-controlled host)。

- **i18n 新增**: `set.token.ext.provider.finmind_token` / `set.token.ext.hint.finmind` / `set.quotes.finmind.providerHint` / `set.quotes.finmind.noKey.{title,body,goToken,later}` / `set.quotes.finmind.label`。

- **Settings UI 報價 dropdown 加 `finmind`**（`frontend/js/pages/settings.js`）
  - 跟 fubon 同一條跳轉邏輯:切到 finmind 會檢查 `extension_api_keys` 是否有 `finmind_token`,沒有就彈對話框問要不要跳到「外部 API 金鑰」填入。
  - Token provider 下拉選單加 `finmind_token` 選項,使用者可以直接在「外部 API 金鑰」小節填入。

- **Bump `STOCK_HOLD_VERSION` → 2.4.0**（`api/bootstrap.php`）
  - 經 2.3.1 部署驗證發現:每次升級必須 bump version 常數並以 `/health.version` 為部署 anchor (詳見 `memory/2026-10-12.md` §「本地 Apache 部署」)。

### Changed
- **損益歷史 UI**（`frontend/js/pages/reports.js`）：第一張圖改為總資產／市值／現金三條折線，新增第二張每日未實現損益正負長條圖；兩圖共用同步時間軸，正收益綠色、負收益紅色。
- **損益歷史 source 標記**（`api/_pnl.php`）：以各 snapshot 自身日期判定 live / historical_import，避免整個查詢期間誤用起始日期。
- `ALLOWED_EXTENSION_PROVIDERS` 從 `['fubon_api_key']` 擴為 `['fubon_api_key', 'finmind_token']`。
- `POST /settings/quotes` 的 provider whitelist 加 `finmind`。

### Notes
- 預期 push 範圍:2 個 commit(2.3.1 P&L 補入 / 2.4.0 FinMind 報價 + 警示卡修法),共 `M 9` + `?? 4`(.gitignore + 2 個 .php + 2 個 migration)。
- **本次完整修法清單(對應 2.3.1 + 2.4.0)**:
  - `pnl_snapshots` 新表 + `prices.source` ALTER(`migrations/010` / `011`)。
  - `pnl_compute_alerts` 改用 **current streak** 觸發 banner(原 bug:用 all-time max_streak 觸發,歷史曾經 5 天連跌會永久亮警示卡)。
  - `pnl_backfill_start` 加孤兒偵測:當 `latest` 那筆 `prev_close_value=0`,強制 rewind 到 first txn_date 重算。
  - `ensure_pnl_snapshots` 內 `$haveData` 收斂為 `$allHaveData`,避免最後一個 sec 寫的 true 掩蓋前面缺漏。
  - `pnl_persist_history` 的 `sec['id']` 改 `sec['security_id'](FK hotfix)。
  - `pnl_read_history` 加 daily_diff 計算(每筆 snapshot 跨所有 sec 的當日 close vs 前一交易日 close,sum 進 long array)。
  - `fetch_finmind_quotes` 顯式帶 `source='live'`(繞過 normalize 邊界)。
  - 損益歷史 reports 頁:第二張圖從 unrealized 換成 daily_diff,中文 title/legend。
  - Settings ⑨ 警示小節的「連續下跌」輸入框,改抓 `consecutive_threshold`(使用者設的門檻),不是 `consecutive_down_days`(當前 streak)。
  - `.gitignore` 加 `/log/*.log.*` + `/memory/`(避免推送日誌與私人 memory 到公開 repo)。
- 部署流程跟 2.3.0 / 2.3.1 一樣:rsync + bump version,然後使用者到 Settings → 外部 API 金鑰填 finmind_token,切報價來源為 finmind。
- FinMind token 是免費註冊的,不必付費。註冊網址 `https://finmindtrade.com/`。
- **部署到本地 Apache 10.35.32.11 之後需驗證**:user 登入 → dashboard 警示卡消失 → Settings → 外部 API 金鑰填入 token → 切報價來源為 finmind → 按「立即更新全部持股」看 log。

## [2.3.1] - 2026-10-12

### Added
- **P&L 歷史補入 (`api/_pnl_history.php` + `migrations/011-prices-source.sql`)**（`api/index.php` + `api/_pnl.php` + 前端）
  - 補算引擎原本只讀 `prices` 表現有收盤,遇「使用者未按過重新整理」的期間全部跳過 → 歷史曲線大量斷點。新增 `_pnl_history.php`,在 `ensure_pnl_snapshots` 偵測到「有持倉但缺價」時,依 `app_settings.quotes.provider` 分派:
    - `twse_mis` → TWSE 個股日線 `STOCK_DAY?date=YYYYMM01&stockNo=...` (一個 symbol 一個月一次)
    - `yahoo` → `query1.finance.yahoo.com/v8/finance/chart/<symbol>?period1=...&period2=...&interval=1d` (一個 symbol 整段一次)
    - `fubon` / `manual` → no-op (跟現報價行為一致)
  - 範圍預設 365 天 (`app_settings.pnl.historical.max_lookback_days` 可調),只補「今天以前」的日期,不打今天。
  - 拉回來寫入 `prices` 表時以 `source='historical_import'` 標記,跟當下報價的 `source='live'` 區隔。同一日期後來被報價刷新時,`source` 不會被降級為 historical_import(同欄位 CASE WHEN 保護)。
  - ROC 日期解析: `pnl_parse_roc_date('114/10/12') → { iso: '2025-10-12', yyyymmdd: '20251012' }`。

- **`/pnl/snapshots/ensure` 多回傳 `historical_imported` / `historical_failed` / `historical_skipped`**
  - Dashboard mount 補算後,若有 > 0 筆歷史被補入,顯示 `dash.historical.toast` 一則 toast,告知使用者「這些是重構的」。

- **損益歷史圖表標示 source**（`frontend/js/pages/reports.js` + `frontend/js/i18n.js`）
  - `pnl_read_history` 多回傳 `source` 陣列 (每筆對應 'live' 或 'historical_import')。
  - SVG marker: 當日報價 → 實心圓,歷史補入 → 半透明空心圓。
  - 圖表下方加圖例 (live / historical_import 兩種樣式)。

- **i18n 新增**: `rpt.history.legend.live` / `rpt.history.legend.historical` / `dash.historical.toast`。

### Changed
- **`prices` 表加 `source` 欄位**（`migrations/011-prices-source.sql`）
  - `TEXT NOT NULL DEFAULT 'live' CHECK(source IN ('live','historical_import'))`。
  - 既有 row 自動視為 live,新 row 走 INSERT 路徑。
  - 配合既有 `UNIQUE(security_id,date)` 衝突策略,live 不會被 historical 覆蓋。
- **`persist_prices` 帶 `source` 欄位 INSERT/UPDATE**。
- **`_pnl_history.php` 走 `app_settings.pnl.historical.max_lookback_days`**(預設 365)。

### Notes
- 全部 commit 仍留在本地 main;git status 預期 8M(2.3.0)+ 4N(`_pnl_history.php`、`011-prices-source.sql`、新版 mock-reports、新版 reports.js)共 8M+6N 待 push。
- 歷史補入在網路層走對外(HTTP 出埠);若 VPS firewall 對外封鎖 `www.twse.com.tw` / `query1.finance.yahoo.com`,補入會失敗並回 `historical_failed`。可從 dashboard toast 觀察到。
- 歷史補入不打今天,避免重複打當日報價的快取。

## [2.3.0] - 2026-10-12

### Added
- **每日 / 每月損益快照（`pnl_snapshots` 表）**（`migrations/010-pnl-snapshots.sql` + `api/_pnl.php` + `api/index.php`）
  - 新表 `pnl_snapshots` 存每日（granularity='D'）與每月（granularity='M'）的市值 / 現金 / 總資產 / 未實現 / 累計已實現 / 前一交易日市值 / 資料完整旗標。
  - `UNIQUE(user_id, snapshot_date, granularity)` 為冪等錨點，多 tab 同時觸發補算安全。
  - 補算引擎 `api/_pnl.php`：每個登入週期由 dashboard 觸發 `GET /pnl/snapshots/ensure`；偵測到缺日就逐日補；缺價的交易日整日跳過（圖表不會看到假資料）。
  - 月度 snapshot 只寫「上一個已結束月」；當月不結算（產品決策，保持「已收尾」語意）。
  - 不維護國定假日表：週末跳過即可，非交易日缺資料就沒點，圖表自然斷開。

- **損益歷史報表（`GET /reports/pnl-history`）**（`api/index.php` + `frontend/js/pages/reports.js`）
  - 從 `pnl_snapshots` 拉區間資料，回傳 total / market / cash / unrealized / realized / daily_change / daily_change_pct 平行陣列。
  - 前端用自製 SVG 折線圖（無 Chart.js CDN 依賴）；缺資料日以空心圓標示。
  - 報表頁 tabs 從 4 個（realized / unrealized / dividend / tax）縮為 2 個（history / dividends）；配息 tab 仍保留並實作 qty / amount_twd 的 FIFO 計算。

- **Dashboard 警示卡**（`frontend/js/pages/dashboard.js` + `GET /reports/pnl-alerts`）
  - mount 開頭 fire-and-forget 補算（`api.pnl.ensure().catch(noop)`），絕不擋主頁。
  - 補算後拉 alerts，觸發時在 metric cards 上方顯示紅色 banner + 警示 chip。
  - banner 含「調整門檻」連結，導到 `settings.html#alerts` 並高亮 ⑨ 區段。

- **Settings ⑨ 損益警示門檻**（`frontend/js/pages/settings.js` + `GET/POST /settings/pnl-alerts`）
  - 4 個可調參數：啟用開關、連續下跌 N 日（預設 3）、觀察 N 天（預設 5）、跌幅門檻 %（預設 -3）。
  - 儲存走 `app_settings` 既有體系（`pnl.alerts.*`），不另開表。

### Changed
- **Reports 頁面大改**（`frontend/js/pages/reports.js` + `frontend/js/api-client.js` + `frontend/js/i18n.js`）
  - 移除「已實現損益」、「未實現損益」、「稅務估算」三個 tab 與其 UI / 程式碼。
  - `api-client.js` 移除 `reports.realized` / `reports.unrealized` / `reports.taxEstimate`；新增 `reports.pnlHistory` / `reports.pnlAlerts` / `pnl.ensure`。
  - `i18n.js` 移除 `rpt.tab.realized` / `rpt.tab.unrealized` / `rpt.tab.tax` 與對應字串；新增 `rpt.tab.history` / `rpt.tab.dividends`（複數化統一）/ `rpt.history.*` / `dash.alert.*` / `set.alerts.*` / `set.anchor.alerts` / `set.sec.alerts`。
- **API 端點清理**（`api/index.php`）
  - 刪除 `GET /reports/unrealized` 整段（前端不再呼叫）。
  - 補上 `GET /reports/dividends` 的 qty (FIFO) 與 amount_twd (FX) 計算 — 之前回傳 `qty="0"` / `amount_twd="0"`，是 dead payload。

### Notes
- 全部 commit 仍留在本地 main 分支，git status 預期有 9 個 modified + 4 個 new（含 migration、_pnl.php、reports.js、dashboard.js、settings.js、api-client.js、i18n.js、mock-reports.js、CHANGELOG.md）；待 push。
- 補算觸發點刻意只做在 dashboard；其他頁面（holdings / transactions / reports / settings）登入後由 tab 切換或 refresh 動作間接走 `/pnl/snapshots/ensure`（下次若 reports 頁也需要即時歷史再補）。
- 模擬模式（`mockReports.pnlHistory` / `pnlAlerts`）已對齊真實後端的 shape；前端開發時切到 mock 不需改 JS。

## [2.2.0] - 2026-10-07

### Added
- **Dashboard 版次 / 最後更新 footer** (`frontend/dashboard.html` + `frontend/css/layout.css` + `frontend/js/pages/dashboard.js`)
  - 底部新增固定 footer，顯示目前版本（取自 `/health.version`）與最後報價更新時間。
  - 同一份資料同步寫入 `<meta name="app:version">` 與 `<meta name="app:last-update">`，讓 devtools / crawler 與可見 UI 一致。
  - Layout 為 `.app` grid 第四列，手機版 / 桌面版都不破壞既有的 header / main / tabbar 結構。

- **帳戶硬刪除（`POST /accounts/delete`）** (`api/index.php` + `frontend/js/pages/settings.js` + `frontend/js/mock/mock-accounts.js`)
  - 與既有「停用」(`/accounts/disable`，僅翻 `status='INACTIVE'`) 並列；保留歷史列以供報表。
  - 真正硬刪除前會檢查 `transactions` 是否有指向此帳戶的紀錄：若有則回 `422 ACCOUNT_HAS_TRANSACTIONS`，detail 帶入 `count` / `account_id` / `account_name`，前端直接用 toast 顯示筆數並中止程序。
  - 沒有交易時順便清掉 `positions` 對應列，整筆交易在 PDO transaction 內完成。

- **外部 API 金鑰 (Extension API Keys)** (`migrations/009-extension-api-keys.sql` + `api/index.php` + `frontend/js/mock/mock-extension-keys.js` + 既有設定頁)
  - 新增 `extension_api_keys` 表：以 AES-256-CBC 加密儲存、隨機 IV per row、僅保留前 8 碼供識別。Plaintext 在初次寫入後永遠不再回傳。
  - 三個新 endpoint：`GET /extension-keys`、`POST /extension-keys/upsert`（`UNIQUE(user_id, provider)`，重複 provider 直接取代）、`POST /extension-keys/delete`。
  - Provider 白名單由後端 `ALLOWED_EXTENSION_PROVIDERS` 控管，目前 `['fubon_api_key']`，新增只需改一個陣列。
  - 加密金鑰推導順序：`STOCK_HOLD_EXTENSION_KEY_SECRET` → `STOCK_HOLD_INIT_TOKEN` → 標示為 INSECURE 的 fallback。`.env.example` 已補上說明與 `openssl rand -hex 32` 建議。
  - 設定頁的「API Token」分區新增子區塊「外部 API 金鑰」，與既有自動產生區塊共存；provider 下拉 + 金鑰輸入（password） + 儲存 / 取代 + 個別刪除確認。

- **Fubon Neo API 作為報價來源** (`api/index.php` + `frontend/js/pages/settings.js`)
  - 「⑤ 報價更新」新增 `fubon` provider 選項，與既有 `twse_mis` / `manual` 並列。
  - 切換為 fubon 時，前端自動檢查 `extension_api_keys` 是否已有 `fubon_api_key`；若無則彈出確認對話框詢問是否跳轉到「API Token」區塊設定。
  - 後端 dispatch：`/prices/batch-update` 依 provider 分派到 `fetch_twse_mis_quotes` 或新的 `fetch_fubon_quotes`；後者先讀取 / 解密使用者金鑰，再回 `501 FUBON_PROVIDER_NOT_IMPLEMENTED`，附上 `D:\Python\venv\fubon_api\SKILL.md` 參考位置。
  - 為何目前是 501：fubon_neo SDK 是 binary，需要 `apikey_login(personal_id, api_key, cert_path, cert_pass)`，PHP 後端無法直接呼叫；完整整合需要獨立的 Python service。

### Changed
- i18n.js：補上之前切片漏寫的 zh-TW 字串（`set.acc.action.delete` / `set.acc.confirmDelete.*` / `set.acc.delete.hasTransactions.*` / `set.token.ext.*`），同時新增 `set.quotes.fubon.*`（en + zh-TW）。

### Notes
- 全部 commit 仍留在本地 main 分支（git status 顯示 3 ahead of origin/main），待你 push。

## [2.1.1] - 2026-10-05

### Changed
- 修正「新增交易」交易類別分類:
  - **銀行**:存入 / 提出 / 轉入 / 轉出 / **配息**(原:存入 / 提出 / 轉入 / 轉出 / 手續費)
  - **券商**:買進 / 賣出 / 分割 / 合併 / 配股(原:買進 / 賣出 / **配息** / 分割 / 合併 / 配股)
  - 「配息」改屬銀行業務——配息是現金流入銀行帳戶,與券商「數量 × 價格」的交易模型無關。
  - 「手續費」交易類別移除——每筆交易已有內建 `fees` 欄位,無須以獨立類型存在。
- 連動更新:
  - `frontend/js/pages/transactions.js` — `BANK_TYPES` / `STOCK_TYPES` / `TYPE_KEYS` / 交易徽章 / 金額正負號邏輯
  - `frontend/js/i18n.js` — 移除 `txnType.FEE` 字串、更新 `txn.amount.hint` 提示文案
  - `frontend/js/mock/mock-transactions.js` — mock 資料與 `TYPE_SORT` 同步調整
  - `api/index.php` — `$allowed` 型別白名單、金額正負號判斷、`/transactions/reverse` 的非 BUY/SELL fallback 由 `FEE` 改為 `WITHDRAW`(同為負號沖銷語意,且仍為合法型別)
