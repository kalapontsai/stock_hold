/**
 * stock_hold — Mock: Reports (dividends, pnl history, pnl alerts)
 *
 * 2.3.0: removed `realized` and `taxEstimate` mocks. The Reports page no
 * longer surfaces realized P&L (it lives in the pnl-history tab now) and
 * the tax tab is dropped entirely. Dividends + pnl mocks stay.
 */

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

export async function pnlHistory({ query } = {}) {
  // 60-day synthetic curve; 0.5% daily drift + noise. Mock-only — real
  // data comes from /api/v1/reports/pnl-history which reads pnl_snapshots.
  const days = 60;
  const labels = [];
  const total = [];
  const market = [];
  const cash = [];
  const unrealized = [];
  const realized = [];
  const daily = [];
  const dailyPct = [];
  let baseTotal = 1500000;
  for (let i = 0; i < days; i++) {
    const d = new Date("2026-09-23T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    const label = d.toISOString().slice(0, 10);
    const drift = Math.sin(i * 0.35) * 6000 + (i - days / 2) * 1200;
    const noise = ((i * 9301 + 49297) % 233280) / 233280 * 4000 - 2000;
    const marketV = Math.max(0, baseTotal * 0.85 + drift + noise);
    const cashV   = Math.max(0, baseTotal * 0.10 + (i % 7) * 1500);
    const totalV  = marketV + cashV;
    const unreal  = marketV - (baseTotal * 0.85 * 0.92);
    const real    = 8000 + i * 150;
    labels.push(label);
    market.push(Number(marketV.toFixed(2)));
    cash.push(Number(cashV.toFixed(2)));
    total.push(Number(totalV.toFixed(2)));
    unrealized.push(Number(unreal.toFixed(2)));
    realized.push(Number(real.toFixed(2)));
    if (i === 0) {
      daily.push(0);
      dailyPct.push(0);
    } else {
      const delta = totalV - total[i - 1];
      daily.push(Number(delta.toFixed(2)));
      dailyPct.push(Number(((delta / total[i - 1]) * 100).toFixed(2)));
    }
    baseTotal = totalV;
  }
  // Apply date filter if provided.
  let fromIdx = 0, toIdx = labels.length;
  if (query?.from) fromIdx = labels.findIndex((l) => l >= query.from);
  if (query?.to)   toIdx   = labels.findIndex((l) => l >  query.to) ;
  if (fromIdx < 0) fromIdx = 0;
  if (toIdx < 0)   toIdx = labels.length;
  if (toIdx < fromIdx) toIdx = fromIdx;
  return {
    granularity: "D",
    labels: labels.slice(fromIdx, toIdx),
    market_value: market.slice(fromIdx, toIdx),
    cash_balance: cash.slice(fromIdx, toIdx),
    total_assets: total.slice(fromIdx, toIdx),
    unrealized_pnl: unrealized.slice(fromIdx, toIdx),
    realized_pl: realized.slice(fromIdx, toIdx),
    daily_change: daily.slice(fromIdx, toIdx),
    daily_change_pct: dailyPct.slice(fromIdx, toIdx),
    // 2.3.1: per-point source tag ('live' or 'historical_import'). Mock
    // treats the first 5 days as historical, the rest as live, so the
    // UI can exercise both marker styles.
    source: labels.slice(fromIdx, toIdx).map((_, i) => (i < 5 ? "historical_import" : "live")),
  };
}

export async function pnlAlerts() {
  // Mock: matches the dev defaults (3 / 5 / -3) but only the second rule
  // is actually triggered so the UI exercises both paths.
  return {
    enabled: true,
    consecutive_down_days: 2,
    consecutive_threshold: 3,
    consecutive_triggered: false,
    window_days: 5,
    window_pct: -3.42,
    window_threshold: -3.0,
    window_triggered: true,
    triggered: [
      { type: "window_pct", value: -3.42, threshold: -3.0, window_days: 5 },
    ],
  };
}
