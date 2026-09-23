/**
 * stock_hold — Mock: Dashboard summary data
 */

export async function summary() {
  return {
    total_assets:       "2345600",
    total_assets_prev:  "2297800",
    today_pnl:          "12450",
    today_pnl_pct:      "0.53",
    mtd_pnl:            "88200",
    mtd_pnl_pct:        "3.9",
    unrealized_pnl:     "156300",
    unrealized_pnl_pct: "7.1",
    realized_mtd:       "3200",
    dividend_mtd:       "1800",
    holdings_count:     7,
    holdings_positive:  5,
    usage_pct:          75,
    as_of:              "2026-09-23T09:30:00Z",
  };
}

export async function allocation() {
  return [
    { label: "台股", value: 1407360, color: "var(--chart-1)" },
    { label: "美股", value: 586400,  color: "var(--chart-2)" },
    { label: "基金", value: 234560,  color: "var(--chart-3)" },
    { label: "現金", value: 117280,  color: "var(--chart-4)" },
  ];
}

export async function recent({ query } = {}) {
  const limit = Number(query?.limit || 5);
  const rows = [
    { id: "tx-0001", txn_date: "2026-09-22", type: "BUY",      symbol: "2330",   qty: "1000", price: "580.00", amount: "-580000", currency: "TWD" },
    { id: "tx-0002", txn_date: "2026-09-21", type: "DIVIDEND", symbol: "0056",   qty: "5000", price: "1.24",   amount: "+6200",   currency: "TWD" },
    { id: "tx-0003", txn_date: "2026-09-20", type: "SELL",     symbol: "AAPL",   qty: "10",   price: "190.00", amount: "+150000", currency: "TWD" },
    { id: "tx-0004", txn_date: "2026-09-19", type: "BUY",      symbol: "00878",  qty: "5000", price: "20.00",  amount: "-100000", currency: "TWD" },
    { id: "tx-0005", txn_date: "2026-09-18", type: "DEPOSIT",  symbol: "—",      qty: null,   price: null,    amount: "+50000",  currency: "TWD" },
    { id: "tx-0006", txn_date: "2026-09-15", type: "DIVIDEND", symbol: "00878",  qty: "5000", price: "0.40",   amount: "+2000",   currency: "TWD" },
    { id: "tx-0007", txn_date: "2026-09-12", type: "BUY",      symbol: "2330",   qty: "1000", price: "545.00", amount: "-545000", currency: "TWD" },
    { id: "tx-0008", txn_date: "2026-09-10", type: "BUY",      symbol: "AAPL",   qty: "20",   price: "175.00", amount: "-111000", currency: "TWD" },
  ];
  return rows.slice(0, limit);
}

export async function monthlyPnl() {
  return {
    labels: ["10月","11月","12月","1月","2月","3月","4月","5月","6月","7月","8月","9月"],
    realized:   ["15000","22000","8000","12000","-5000","18000","25000","20000","16000","28000","32000","33000"],
    unrealized: ["10000","15000","12000","18000","22000","-8000","10000","12000","15000","18000","22000","28000"],
  };
}
