/**
 * stock_hold — Mock: Securities (stocks / ETFs / funds)
 */

const SECURITIES = [
  { id: "sec-2330", symbol: "2330",  exchange: "TW", currency: "TWD", name: "台積電",       type: "STOCK", sector: "半導體",   status: "active" },
  { id: "sec-0056", symbol: "0056",  exchange: "TW", currency: "TWD", name: "元大高股息",   type: "ETF",   sector: "ETF",      status: "active" },
  { id: "sec-00878", symbol: "00878", exchange: "TW", currency: "TWD", name: "國泰永續高息", type: "ETF",   sector: "ETF",      status: "active" },
  { id: "sec-aapl", symbol: "AAPL",  exchange: "US", currency: "USD", name: "Apple Inc.",  type: "STOCK", sector: "科技",      status: "active" },
  { id: "sec-msft", symbol: "MSFT",  exchange: "US", currency: "USD", name: "Microsoft",   type: "STOCK", sector: "科技",      status: "active" },
  { id: "sec-vti",  symbol: "VTI",   exchange: "US", currency: "USD", name: "Vanguard Total Market", type: "ETF", sector: "ETF", status: "active" },
];

export async function listSecurities() {
  return [...SECURITIES];
}

export async function getSecurity() {
  return SECURITIES[0];
}

export async function createSecurity({ body } = {}) {
  const security = {
    id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symbol: String(body.symbol || "").toUpperCase(),
    exchange: body.exchange || "TW",
    currency: body.currency || "TWD",
    name: body.name,
    type: body.type || "STOCK",
    sector: body.sector || null,
    status: "active",
  };
  SECURITIES.push(security);
  return { ...security };
}

export async function updateSecurity({ body } = {}) {
  const security = SECURITIES.find((item) => item.id === body.id);
  if (!security) throw new Error("標的不存在");
  Object.assign(security, body);
  return { ...security };
}

export async function deleteSecurity({ body } = {}) {
  const security = SECURITIES.find((item) => item.id === body.id);
  if (!security) throw new Error("標的不存在");
  security.status = "disabled";
  return { id: security.id, deleted: true, is_active: false };
}
