/**
 * stock_hold — Mock: Prices (last-update timestamp)
 */

export async function lastUpdate() {
  return {
    as_of: "2026-09-23T09:30:00Z",
    last_source: "yfinance",
    updated_count: 24,
    failed: [],
  };
}
