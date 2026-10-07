# Changelog

本檔記錄 stock_hold 的所有重要變更。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/),版本遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

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