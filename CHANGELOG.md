# Changelog

本檔記錄 stock_hold 的所有重要變更。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/),版本遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [1.0.0] - 2026-10-05

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