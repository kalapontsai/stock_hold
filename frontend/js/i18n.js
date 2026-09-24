/**
 * stock_hold — i18n module (zh-TW default)
 *
 * Loads string tables and exposes a `t(key, params?)` helper.
 * Per DESIGN-TOKENS.md §13 + extra keys needed by the 5 pages.
 *
 * Usage:
 *   import { t, setLocale, getLocale } from "./i18n.js";
 *   t("nav.dashboard");                       // "總覽"
 *   t("metric.value", { v: "100" });          // "NT$ 100"
 */

const STRINGS = {
  "zh-TW": {
    /* App shell */
    "app.title":                  "股票與資產記帳",
    "app.tagline":                "local-first、本機優先",
    "app.offlineBanner":          "離線模式（資料可能過時）",
    "app.skipToMain":             "跳至主要內容",

    /* Navigation */
    "nav.dashboard":              "總覽",
    "nav.transactions":           "交易",
    "nav.holdings":               "持倉",
    "nav.reports":                "報表",
    "nav.settings":               "設定",

    /* Common actions */
    "action.refresh":             "更新市價",
    "action.refreshDone":         "市價已更新",
    "action.refreshFailed":       "市價更新失敗（{code}），5 秒後重試",
    "action.add":                 "新增",
    "action.edit":                "編輯",
    "action.copy":                "複製",
    "action.delete":              "刪除",
    "action.save":                "儲存",
    "action.cancel":              "取消",
    "action.confirm":             "確認",
    "action.clear":               "清除篩選",
    "action.clearAll":            "清除所有篩選",
    "action.search":              "搜尋",
    "action.loadMore":            "載入更多",
    "action.run":                 "執行",
    "action.regenerate":          "重新產生",
    "action.show":                "顯示",
    "action.hide":                "隱藏",
    "action.runReconcile":        "執行對帳",
    "action.backup":              "立即備份",
    "action.restore":             "從備份還原",
    "action.healthCheck":         "健康檢查",
    "action.checkUpdate":         "檢查更新",

    /* Metrics */
    "metric.totalAssets":         "總資產",
    "metric.todayPnl":            "今日損益",
    "metric.mtdPnl":              "月初至今",
    "metric.ytdPnl":              "年初至今",
    "metric.unrealizedPnl":       "未實現損益",
    "metric.realizedPnl":         "已實現損益",
    "metric.dividendYield":       "殖利率",
    "metric.winningRate":         "勝率",
    "metric.avgHoldingDays":      "平均持有天數",
    "metric.maxSingleGain":       "最大單筆獲利",
    "metric.totalCost":           "總成本",
    "metric.marketValue":         "市值",
    "metric.dataAsOf":            "資料截至 {ts}",
    "metric.usageProgress":       "使用率 {pct}%",
    "metric.vsLastMonth":         "vs 上月 {pct}%",

    /* Dashboard */
    "dashboard.allocation":       "資產配置",
    "dashboard.recent":           "最近 5 筆交易",
    "dashboard.viewAll":          "查看全部",
    "dashboard.monthlyPnl":       "月度損益 (近 12 個月)",
    "dashboard.chartPie":         "圓餅圖",
    "dashboard.chartBar":         "長條圖",
    "dashboard.realized":         "已實現",
    "dashboard.unrealized":       "未實現",

    /* Transactions */
    "txn.title":                  "交易 Transactions",
    "txn.add":                    "新增交易",
    "txn.edit":                   "編輯交易",
    "txn.col.date":               "日期",
    "txn.col.account":            "帳戶",
    "txn.col.type":               "類型",
    "txn.col.symbol":             "標的",
    "txn.col.qty":                "數量",
    "txn.col.price":              "價格",
    "txn.col.amount":             "金額(TWD)",
    "txn.col.note":               "備註",
    "txn.col.actions":            "操作",
    "txn.filter.dateRange":       "日期",
    "txn.filter.account":         "帳戶",
    "txn.filter.symbol":          "標的",
    "txn.filter.type":            "類型",
    "txn.filter.reconciled":      "已對帳",
    "txn.filter.unreconciled":    "未對帳",
    "txn.searchPlaceholder":      "搜尋標的或帳戶名稱…",
    "txn.selected":               "已選 {n} 筆",
    "txn.batchDelete":            "批次刪除",
    "txn.deleteConfirm.title":    "刪除交易",
    "txn.deleteConfirm.body":     "確定要刪除這筆交易嗎？此操作無法復原。",
    "txn.deleteConfirm.batchBody": "確定要刪除已選的 {n} 筆交易嗎？此操作無法復原。",
    "txn.field.type":             "類型",
    "txn.field.account":          "帳戶",
    "txn.field.symbol":           "標的",
    "txn.field.date":             "日期",
    "txn.field.qty":              "數量",
    "txn.field.price":            "價格",
    "txn.field.fees":             "手續費",
    "txn.field.fxRate":           "匯率",
    "txn.field.note":             "備註",
    "txn.field.amount":           "金額",
    "txn.amount.hint":            "銀行類交易必填；未填時自動依類型計算（存入/轉入為正、提出/轉出/手續費為負）",
    "txn.category.label":         "交易類別",
    "txn.category.bank":          "銀行",
    "txn.category.stock":         "證卷",
    "txn.note.divHint":           "DIV 類型將自動寫入 dividends 表，amount_per_share = 價格 × 數量",
    "txn.qty.unit":               "股 / 單位",
    "txn.empty":                  "這段時間沒有交易",
    "txn.empty.clear":            "清除篩選",

    /* Transaction types */
    "txnType.BUY":                "買進",
    "txnType.SELL":               "賣出",
    "txnType.DIVIDEND":           "配息",
    "txnType.DEPOSIT":            "存入",
    "txnType.WITHDRAW":           "提出",
    "txnType.TRANSFER_IN":        "轉入",
    "txnType.TRANSFER_OUT":       "轉出",
    "txnType.FEE":                "手續費",
    "txnType.SPLIT":              "分割",
    "txnType.MERGER":             "合併",
    "txnType.RIGHTS":             "配股",

    /* Localized English for the new strings (kept short, not full translation). */
    "txn.category.label":         "Category",
    "txn.category.bank":          "Bank",
    "txn.category.stock":         "Brokerage",
    "set.acc.action.disable":     "Disable",
    "set.acc.action.enable":      "Enable",
    "set.acc.filter.showDisabled":  "Show disabled accounts",

    /* Holdings */
    "hold.title":                 "持倉 Holdings",
    "hold.summary":               "彙總",
    "hold.sortBy":                "排序",
    "hold.sortBy.unrealizedPnl":  "未實現損益",
    "hold.sortBy.marketValue":    "市值",
    "hold.sortBy.symbol":         "標的",
    "hold.col.symbol":            "標的",
    "hold.col.account":           "帳戶",
    "hold.col.qty":               "數量",
    "hold.col.avgCost":           "平均成本",
    "hold.col.price":             "現價",
    "hold.col.marketValue":       "市值",
    "hold.col.unrealizedPnl":     "未實現 P/L",
    "hold.col.yield":             "殖利率",
    "hold.empty":                 "目前沒有持倉，先到「交易」新增第一筆 BUY 吧！",
    "hold.empty.cta":             "前往新增交易",
    "hold.total":                 "顯示 {shown} 筆 / 共 {total} 筆",

    /* Reports */
    "rpt.title":                  "報表 Reports",
    "rpt.period":                 "期間",
    "rpt.tab.realized":           "已實現損益",
    "rpt.tab.unrealized":         "未實現損益",
    "rpt.tab.dividend":           "配息",
    "rpt.tab.tax":                "稅務估算",
    "rpt.col.symbol":             "標的",
    "rpt.col.exDate":             "除息",
    "rpt.col.payDate":            "入帳",
    "rpt.col.perShare":           "每股",
    "rpt.col.total":              "總額(TWD)",
    "rpt.col.qty":                "數量",
    "rpt.col.price":              "價格",
    "rpt.col.amount":             "金額",
    "rpt.tax.twDividend":         "台股利得",
    "rpt.tax.usWithholding":      "美股股利預扣",
    "rpt.tax.realizedNote":       "已實現損益 ({year})：{gain} - 免稅額 NT$ 10 萬 → 課稅 {tax}",
    "rpt.tax.disclaimer":         "稅務公式為估算用，非正式申報",
    "rpt.tax.downloadCsv":        "下載 CSV",
    "rpt.tax.copySummary":        "複製摘要",
    "rpt.dividend.total":         "合計配息 NT$ {twd}  + {usd} USD (≈ NT$ {approx})",

    /* Settings */
    "set.title":                  "設定 Settings",
    "set.anchor.accounts":        "① 帳戶",
    "set.anchor.securities":      "② 標的",
    "set.anchor.skills":          "③ Skill 啟停",
    "set.anchor.token":           "④ API Token",
    "set.anchor.quotes":          "⑤ 報價更新",
    "set.anchor.appearance":      "⑥ 外觀",
    "set.anchor.reconcile":       "⑦ 對帳",
    "set.anchor.maintenance":     "⑧ 維護",
    "set.sec.accounts":           "帳戶",
    "set.sec.securities":         "標的",
    "set.sec.skills":             "Skill 啟停",
    "set.sec.token":              "API Token",
    "set.sec.appearance":         "外觀",
    "set.sec.reconcile":          "對帳",
    "set.sec.maintenance":        "維護",
    "set.token.label":            "Agent / 外部呼叫用 token：",
    "set.token.permission":       "權限：{perm}",
    "set.token.ipRestriction":    "IP 限制：{ip}",
    "set.appearance.theme":       "主題",
    "set.appearance.light":       "淺色",
    "set.appearance.dark":        "深色",
    "set.appearance.system":      "跟隨系統",
    "set.appearance.numFont":     "數字字型",
    "set.appearance.tabular":     "等寬",
    "set.appearance.proportional":"比例",
    "set.appearance.baseCcy":     "Base currency",
    "set.reconcile.tolerance":    "容忍值",
    "set.reconcile.unit":         "單位：原幣",
    "set.reconcile.lastRun":      "上次執行：{ts}",
    "set.acc.type.bank":          "銀行",
    "set.acc.type.broker":        "券商",
    "set.acc.status.active":      "啟用",
    "set.acc.status.disabled":    "停用",
    "set.acc.action.disable":     "停用",
    "set.acc.action.enable":      "啟用",
    "set.acc.confirmDisable.title": "停用帳戶",
    "set.acc.confirmDisable.body":  "停用後此帳戶不會再出現在「新增交易」的帳戶選單；歷史交易與持倉紀錄會完整保留。如需完全清除請從維護頁清表。",
    "set.acc.confirmEnable.title":  "啟用帳戶",
    "set.acc.confirmEnable.body":   "啟用後此帳戶會重新出現在「新增交易」的帳戶選單。",
    "set.acc.filter.showDisabled":  "顯示已停用帳戶",

    /* Errors / feedback */
    "error.unauthorized":         "請重新設定 API token",
    "error.server":               "資料載入失敗，稍後重試",
    "error.network":              "網路連線異常",
    "error.validation":           "欄位驗證失敗",
    "loading":                    "載入中…",
    "saved":                      "已儲存",
    "deleted":                    "已刪除",
    "confirm":                    "確定",

    /* Date format */
    "date.today":                 "今天",
    "date.yesterday":             "昨天",
  },

  "en": {
    "app.title":                  "Stock Hold",
    "app.tagline":                "local-first",
    "app.offlineBanner":          "Offline mode (data may be stale)",
    "app.skipToMain":             "Skip to main content",
    "nav.dashboard":              "Dashboard",
    "nav.transactions":           "Transactions",
    "nav.holdings":               "Holdings",
    "nav.reports":                "Reports",
    "nav.settings":               "Settings",
    "action.refresh":             "Refresh Prices",
    "action.refreshDone":         "Prices updated",
    "action.refreshFailed":       "Price update failed ({code}), retrying in 5s",
    "action.add":                 "Add",
    "action.edit":                "Edit",
    "action.copy":                "Copy",
    "action.delete":              "Delete",
    "action.save":                "Save",
    "action.cancel":              "Cancel",
    "action.confirm":             "Confirm",
    "action.clear":               "Clear filters",
    "action.clearAll":            "Clear all filters",
    "action.search":              "Search",
    "action.loadMore":            "Load more",
    "action.run":                 "Run",
    "action.regenerate":          "Regenerate",
    "action.show":                "Show",
    "action.hide":                "Hide",
    "action.runReconcile":        "Run reconcile",
    "action.backup":              "Backup now",
    "action.restore":             "Restore from backup",
    "action.healthCheck":         "Health check",
    "action.checkUpdate":         "Check updates",
    "metric.totalAssets":         "Total Assets",
    "metric.todayPnl":            "Today's P/L",
    "metric.mtdPnl":              "Month-to-Date P/L",
    "metric.ytdPnl":              "Year-to-Date P/L",
    "metric.unrealizedPnl":       "Unrealized P/L",
    "metric.realizedPnl":         "Realized P/L",
    "metric.dividendYield":       "Dividend Yield",
    "metric.winningRate":         "Winning Rate",
    "metric.avgHoldingDays":      "Avg Holding Days",
    "metric.maxSingleGain":       "Max Single Gain",
    "metric.totalCost":           "Total Cost",
    "metric.marketValue":         "Market Value",
    "metric.dataAsOf":            "As of {ts}",
    "metric.usageProgress":       "Usage {pct}%",
    "metric.vsLastMonth":         "vs last month {pct}%",
    "error.unauthorized":         "Please reconfigure API token",
    "error.server":               "Failed to load data, please retry",
    "error.network":              "Network error",
    "error.validation":           "Validation failed",
    "loading":                    "Loading…",
    "saved":                      "Saved",
    "deleted":                    "Deleted",
    "confirm":                    "Confirm",
    "date.today":                 "Today",
    "date.yesterday":             "Yesterday",
  },
};

let currentLocale = "zh-TW";

/**
 * Get a translated string for the given key. Supports `{name}` placeholders.
 * Falls back to the key itself if missing, then to en if locale string is missing.
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 */
export function t(key, params) {
  const table = STRINGS[currentLocale] || STRINGS["en"];
  let raw = table[key];
  if (raw === undefined) {
    raw = STRINGS["en"][key];
  }
  if (raw === undefined) {
    return key; // last resort: return key so UI shows what's missing
  }
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name) => {
    return name in params ? String(params[name]) : `{${name}}`;
  });
}

export function setLocale(locale) {
  if (STRINGS[locale]) {
    currentLocale = locale;
    try {
      localStorage.setItem("stock_hold.locale", locale);
    } catch (_) { /* ignore */ }
  }
}

export function getLocale() {
  try {
    const saved = localStorage.getItem("stock_hold.locale");
    if (saved && STRINGS[saved]) {
      currentLocale = saved;
    }
  } catch (_) { /* ignore */ }
  return currentLocale;
}

// Boot: read saved preference (or default zh-TW)
try {
  const saved = localStorage.getItem("stock_hold.locale");
  if (saved && STRINGS[saved]) currentLocale = saved;
} catch (_) { /* ignore */ }

export const LOCALES = Object.keys(STRINGS);
