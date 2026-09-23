/**
 * stock_hold — Mock: Holdings (current positions, derived from transactions)
 *
 * Implements SPEC §1.2.1 (average cost) and §1.2.2 (unrealized P/L).
 * Numbers are pre-computed here to avoid re-running server logic client-side.
 */

const HOLDINGS = [
  {
    security_id: "sec-2330",
    account_id:  "acc-bank-ctbc",
    symbol: "2330", name: "台積電", currency: "TWD",
    qty: "2000", avg_cost: "545.00", current_price: "580.00", price_date: "2026-09-22",
    realized_pl: "0",
    fx_rate: "1.0000",
    transactions_count: 5,
  },
  {
    security_id: "sec-aapl",
    account_id:  "acc-broker-firstsec",
    symbol: "AAPL", name: "Apple Inc.", currency: "USD",
    qty: "30", avg_cost: "175.00", current_price: "190.00", price_date: "2026-09-22",
    realized_pl: "1500",
    fx_rate: "31.5000",
    transactions_count: 4,
  },
  {
    security_id: "sec-0056",
    account_id:  "acc-bank-sinopac",
    symbol: "0056", name: "元大高股息", currency: "TWD",
    qty: "5000", avg_cost: "33.40", current_price: "35.10", price_date: "2026-09-22",
    realized_pl: "1200",
    fx_rate: "1.0000",
    transactions_count: 4,
  },
  {
    security_id: "sec-00878",
    account_id:  "acc-bank-ctbc",
    symbol: "00878", name: "國泰永續高息", currency: "TWD",
    qty: "10000", avg_cost: "18.50", current_price: "20.30", price_date: "2026-09-22",
    realized_pl: "0",
    fx_rate: "1.0000",
    transactions_count: 3,
  },
  {
    security_id: "sec-msft",
    account_id:  "acc-broker-firstsec",
    symbol: "MSFT", name: "Microsoft", currency: "USD",
    qty: "10", avg_cost: "420.00", current_price: "415.00", price_date: "2026-09-22",
    realized_pl: "0",
    fx_rate: "31.5000",
    transactions_count: 2,
  },
  {
    security_id: "sec-vti",
    account_id:  "acc-broker-firstsec",
    symbol: "VTI", name: "Vanguard Total Market", currency: "USD",
    qty: "5", avg_cost: "250.00", current_price: "265.00", price_date: "2026-09-22",
    realized_pl: "0",
    fx_rate: "31.5000",
    transactions_count: 1,
  },
  {
    security_id: "sec-2330",
    account_id:  "acc-bank-sinopac",
    symbol: "2330", name: "台積電", currency: "TWD",
    qty: "0", avg_cost: "0", current_price: "580.00", price_date: "2026-09-22",
    realized_pl: "0",
    fx_rate: "1.0000",
    transactions_count: 0, // sold out — should be hidden if filter on qty>0
  },
];

export async function listHoldings() {
  return HOLDINGS.filter((h) => Number(h.qty) > 0);
}
