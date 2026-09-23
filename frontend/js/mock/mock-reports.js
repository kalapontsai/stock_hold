/**
 * stock_hold — Mock: Reports (realized P/L, dividends, tax estimate)
 */

export async function realized() {
  return {
    summary: {
      total_realized:      "187400",
      winning_rate_pct:    "58.06",  // 18/31
      wins:                18,
      total_trades:        31,
      avg_holding_days:    142,
      max_single_gain:     "82000",
      total_dividend_twd:  "10200",
      total_dividend_usd:  "36",
    },
    monthly: {
      labels: ["10月","11月","12月","1月","2月","3月","4月","5月","6月","7月","8月","9月"],
      values: ["-3000","15000","22000","8000","12000","-5000","18000","25000","20000","16000","28000","32000"],
    },
    trades: [
      { id: "trade-001", symbol: "2330",  open_date: "2026-01-15", close_date: "2026-05-20", qty: "500",  buy_price: "550.00", sell_price: "612.00", realized_pl: "+31000", holding_days: 125 },
      { id: "trade-002", symbol: "0056",  open_date: "2026-02-10", close_date: "2026-07-15", qty: "2000", buy_price: "33.40",  sell_price: "34.00",  realized_pl: "+1200",  holding_days: 155 },
      { id: "trade-003", symbol: "AAPL",  open_date: "2026-05-10", close_date: "2026-09-20", qty: "10",   buy_price: "180.00", sell_price: "190.00", realized_pl: "+150000",holding_days: 132 },
      { id: "trade-004", symbol: "2330",  open_date: "2026-04-20", close_date: "2026-06-25", qty: "500",  buy_price: "510.00", sell_price: "550.00", realized_pl: "+20000", holding_days: 66  },
      { id: "trade-005", symbol: "00878", open_date: "2026-03-10", close_date: "2026-08-05", qty: "1000", buy_price: "17.80",  sell_price: "19.00",  realized_pl: "+1200",  holding_days: 148 },
      // …31 trades total in real life
    ],
  };
}

export async function dividends({ query } = {}) {
  let rows = [
    { id: "div-001", symbol: "0056",  ex_date: "2026-08-16", pay_date: "2026-09-15", per_share: "1.20",  currency: "TWD", qty: "5000", amount_twd: "6000" },
    { id: "div-002", symbol: "00878", ex_date: "2026-07-15", pay_date: "2026-08-15", per_share: "0.40",  currency: "TWD", qty: "5000", amount_twd: "2000" },
    { id: "div-003", symbol: "AAPL",  ex_date: "2026-08-12", pay_date: "2026-08-18", per_share: "0.24",  currency: "USD", qty: "30",   amount_twd: "216" },
    { id: "div-004", symbol: "MSFT",  ex_date: "2026-08-20", pay_date: "2026-09-10", per_share: "0.75",  currency: "USD", qty: "10",   amount_twd: "226" },
    { id: "div-005", symbol: "2330",  ex_date: "2026-06-15", pay_date: "2026-07-15", per_share: "4.00",  currency: "TWD", qty: "1500", amount_twd: "6000" },
    { id: "div-006", symbol: "00878", ex_date: "2026-02-15", pay_date: "2026-03-15", per_share: "0.35",  currency: "TWD", qty: "5000", amount_twd: "1750" },
  ];
  if (query?.from) rows = rows.filter((r) => r.pay_date >= query.from);
  if (query?.to)   rows = rows.filter((r) => r.pay_date <= query.to);
  return rows;
}

export async function taxEstimate({ query } = {}) {
  return {
    year: 2026,
    tw_dividend_income:    "14000",
    tw_dividend_taxable:   "0",            // 94 方案 or 8.5% 計算後
    us_withholding_usd:    "36",
    us_withholding_twd:    "1080",
    realized_gain:         "187400",
    exemption_twd:         "100000",        // 免稅額 NT$ 10 萬
    taxable_gain:          "87400",
    notes: [
      "台股利得採分離課稅 28% (示例值)。",
      "美股已預扣 10% 股利稅；不再重複計算。",
      "已實現損益 (2026) 超過免稅額的部分，假設併入綜合所得稅。",
    ],
    disclaimer: "稅務公式為估算用，非正式申報結果。",
  };
}
