/**
 * stock_hold — Mock: Skills (per SPEC §2.1 list)
 */

const SKILLS = [
  { name: "marketdata",       source: "yfinance + FinMind", enabled: true,  last_run_at: "2026-09-23T09:30:00Z" },
  { name: "fundamentaldata",  source: "FinMind",            enabled: true,  last_run_at: "2026-09-22T08:00:00Z" },
  { name: "FxDataUpdater",    source: "exchangerate.host",  enabled: true,  last_run_at: "2026-09-23T09:00:00Z" },
  { name: "FinMindExplorer",  source: "FinMind",            enabled: false, last_run_at: null },
  { name: "newsdata",         source: "FinMind / RSS",      enabled: false, last_run_at: null },
  { name: "optionsdata",      source: "yfinance",           enabled: false, last_run_at: null },
];

export async function listSkills() {
  return [...SKILLS];
}
