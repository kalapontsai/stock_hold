/**
 * stock_hold — Mock: Transactions (per SPEC §1.1 entity)
 *
 * Includes BUY, SELL, DIVIDEND, DEPOSIT, WITHDRAW, FEE — enough variety to
 * demo filter chips, sort, and the dual-currency display in Holdings.
 */

const TXNS = [
  { id: "tx-0001", account_id: "acc-bank-ctbc",    txn_date: "2026-09-22", type: "BUY",       security_id: "sec-2330",  qty: "1000", price: "580.00", fees: "20.00", fx_rate: "1.0000", note: "台積電加碼" },
  { id: "tx-0002", account_id: "acc-bank-sinopac", txn_date: "2026-09-21", type: "DIVIDEND",  security_id: "sec-0056",  qty: "5000", price: "1.24",   fees: "0",     fx_rate: "1.0000", note: "Q3 配息" },
  { id: "tx-0003", account_id: "acc-broker-firstsec", txn_date: "2026-09-20", type: "SELL",   security_id: "sec-aapl",  qty: "10",   price: "190.00", fees: "1.00",  fx_rate: "31.5000", note: "減倉 AAPL" },
  { id: "tx-0004", account_id: "acc-bank-ctbc",    txn_date: "2026-09-19", type: "BUY",       security_id: "sec-00878", qty: "5000", price: "20.00",  fees: "0",     fx_rate: "1.0000", note: "" },
  { id: "tx-0005", account_id: "acc-bank-ctbc",    txn_date: "2026-09-18", type: "DEPOSIT",   security_id: null,        qty: null,  price: null,    fees: "0",     fx_rate: "1.0000", note: "薪資存入" },
  { id: "tx-0006", account_id: "acc-bank-sinopac", txn_date: "2026-09-15", type: "DIVIDEND",  security_id: "sec-00878", qty: "5000", price: "0.40",   fees: "0",     fx_rate: "1.0000", note: "Q3 配息" },
  { id: "tx-0007", account_id: "acc-bank-ctbc",    txn_date: "2026-09-12", type: "BUY",       security_id: "sec-2330",  qty: "1000", price: "545.00", fees: "20.00", fx_rate: "1.0000", note: "台積電加碼" },
  { id: "tx-0008", account_id: "acc-broker-firstsec", txn_date: "2026-09-10", type: "BUY",    security_id: "sec-aapl",  qty: "20",   price: "175.00", fees: "1.00",  fx_rate: "31.8000", note: "建倉" },
  { id: "tx-0009", account_id: "acc-bank-ctbc",    txn_date: "2026-09-05", type: "FEE",       security_id: null,        qty: null,  price: null,    fees: "100",   fx_rate: "1.0000", note: "月費" },
  { id: "tx-0010", account_id: "acc-broker-firstsec", txn_date: "2026-09-01", type: "DIVIDEND", security_id: "sec-aapl", qty: "30",   price: "0.24",   fees: "0",     fx_rate: "31.5000", note: "USD 配息 0.24/股" },
  { id: "tx-0011", account_id: "acc-bank-ctbc",    txn_date: "2026-08-28", type: "WITHDRAW",  security_id: null,        qty: null,  price: null,    fees: "0",     fx_rate: "1.0000", note: "提款" },
  { id: "tx-0012", account_id: "acc-bank-sinopac", txn_date: "2026-08-20", type: "BUY",       security_id: "sec-0056",  qty: "5000", price: "33.40",  fees: "0",     fx_rate: "1.0000", note: "" },
  { id: "tx-0013", account_id: "acc-broker-firstsec", txn_date: "2026-08-12", type: "DIVIDEND", security_id: "sec-msft", qty: "10",   price: "0.75",   fees: "0",     fx_rate: "31.5000", note: "" },
  { id: "tx-0014", account_id: "acc-bank-ctbc",    txn_date: "2026-08-01", type: "DEPOSIT",   security_id: null,        qty: null,  price: null,    fees: "0",     fx_rate: "1.0000", note: "薪資" },
  { id: "tx-0015", account_id: "acc-broker-firstsec", txn_date: "2026-07-25", type: "BUY",    security_id: "sec-vti",   qty: "5",    price: "250.00", fees: "1.00",  fx_rate: "31.5000", note: "" },
  { id: "tx-0016", account_id: "acc-bank-sinopac", txn_date: "2026-07-15", type: "SELL",      security_id: "sec-0056",  qty: "2000", price: "34.00",  fees: "0",     fx_rate: "1.0000", note: "部分停利" },
  { id: "tx-0017", account_id: "acc-bank-ctbc",    txn_date: "2026-07-10", type: "BUY",       security_id: "sec-00878", qty: "5000", price: "18.50",  fees: "0",     fx_rate: "1.0000", note: "" },
  { id: "tx-0018", account_id: "acc-broker-firstsec", txn_date: "2026-07-02", type: "BUY",    security_id: "sec-msft",  qty: "10",   price: "420.00", fees: "1.00",  fx_rate: "31.5000", note: "" },
  { id: "tx-0019", account_id: "acc-bank-ctbc",    txn_date: "2026-06-20", type: "BUY",       security_id: "sec-2330",  qty: "500",  price: "530.00", fees: "20.00", fx_rate: "1.0000", note: "" },
  { id: "tx-0020", account_id: "acc-bank-ctbc",    txn_date: "2026-06-01", type: "DEPOSIT",   security_id: null,        qty: null,  price: null,    fees: "0",     fx_rate: "1.0000", note: "薪資" },
  { id: "tx-0021", account_id: "acc-bank-ctbc",    txn_date: "2026-05-15", type: "DIVIDEND",  security_id: "sec-2330",  qty: "1500", price: "4.00",   fees: "0",     fx_rate: "1.0000", note: "" },
  { id: "tx-0022", account_id: "acc-broker-firstsec", txn_date: "2026-05-10", type: "BUY",    security_id: "sec-aapl",  qty: "20",   price: "180.00", fees: "1.00",  fx_rate: "32.0000", note: "" },
  { id: "tx-0023", account_id: "acc-bank-ctbc",    txn_date: "2026-04-20", type: "BUY",       security_id: "sec-2330",  qty: "500",  price: "510.00", fees: "20.00", fx_rate: "1.0000", note: "" },
  { id: "tx-0024", account_id: "acc-bank-sinopac", txn_date: "2026-04-15", type: "BUY",       security_id: "sec-0056",  qty: "2000", price: "33.20",  fees: "0",     fx_rate: "1.0000", note: "" },
  { id: "tx-0025", account_id: "acc-bank-ctbc",    txn_date: "2026-03-10", type: "BUY",       security_id: "sec-00878", qty: "5000", price: "17.80",  fees: "0",     fx_rate: "1.0000", note: "" },
  { id: "tx-0026", account_id: "acc-bank-ctbc",    txn_date: "2026-02-25", type: "DIVIDEND",  security_id: "sec-00878", qty: "5000", price: "0.35",   fees: "0",     fx_rate: "1.0000", note: "" },
  { id: "tx-0027", account_id: "acc-bank-ctbc",    txn_date: "2026-02-15", type: "BUY",       security_id: "sec-2330",  qty: "1000", price: "550.00", fees: "20.00", fx_rate: "1.0000", note: "" },
  { id: "tx-0028", account_id: "acc-bank-sinopac", txn_date: "2026-01-20", type: "BUY",       security_id: "sec-0056",  qty: "3000", price: "32.80",  fees: "0",     fx_rate: "1.0000", note: "" },
  { id: "tx-0029", account_id: "acc-broker-firstsec", txn_date: "2026-01-10", type: "BUY",    security_id: "sec-aapl",  qty: "10",   price: "170.00", fees: "1.00",  fx_rate: "32.5000", note: "" },
  { id: "tx-0030", account_id: "acc-bank-ctbc",    txn_date: "2026-01-05", type: "DEPOSIT",   security_id: null,        qty: null,  price: null,    fees: "0",     fx_rate: "1.0000", note: "年終獎金" },
  { id: "tx-0031", account_id: "acc-bank-sinopac", txn_date: "2025-12-20", type: "DIVIDEND",  security_id: "sec-0056",  qty: "3000", price: "1.10",   fees: "0",     fx_rate: "1.0000", note: "" },
  { id: "tx-0032", account_id: "acc-bank-ctbc",    txn_date: "2025-12-15", type: "BUY",       security_id: "sec-2330",  qty: "500",  price: "540.00", fees: "20.00", fx_rate: "1.0000", note: "" },
];

const TYPE_SORT = {
  BUY: 1, SELL: 2, DIVIDEND: 3, DEPOSIT: 4, WITHDRAW: 5,
  TRANSFER_IN: 6, TRANSFER_OUT: 7, FEE: 8, SPLIT: 9, MERGER: 10,
};

export async function listTransactions({ query } = {}) {
  let rows = [...TXNS];
  if (query) {
    if (query.account_id) rows = rows.filter((r) => r.account_id === query.account_id);
    if (query.security_id) rows = rows.filter((r) => r.security_id === query.security_id);
    if (query.type) rows = rows.filter((r) => r.type === query.type);
    if (query.from) rows = rows.filter((r) => r.txn_date >= query.from);
    if (query.to) rows = rows.filter((r) => r.txn_date <= query.to);
    if (query.search) {
      const q = String(query.search).toLowerCase();
      rows = rows.filter((r) =>
        (r.note || "").toLowerCase().includes(q) ||
        (r.security_id || "").toLowerCase().includes(q) ||
        (r.account_id || "").toLowerCase().includes(q)
      );
    }
  }
  return rows.sort((a, b) => (a.txn_date < b.txn_date ? 1 : a.txn_date > b.txn_date ? -1 : TYPE_SORT[b.type] - TYPE_SORT[a.type]));
}

export async function getTransaction() {
  return TXNS[0];
}
