-- stock_hold 2.3.0 — P&L history snapshot table.
--
-- Why this exists:
--   /dashboard/summary and /reports/realized compute everything live. There is
--   no server-side cron, and the existing report only buckets realized P&L into
--   months — there is no time series we can chart. To draw a real equity curve
--   we need persisted daily (and monthly) snapshots that the dashboard can
--   backfill on the next user login.
--
-- Design:
--   * `granularity` = 'D' (daily) | 'M' (monthly). Monthly rows are written
--     for the *previous* month only — the current month is intentionally not
--     settled, per product decision (we want a clean "closed book" reading
--     for last month, not a half-built one for now).
--   * `UNIQUE(user_id, snapshot_date, granularity)` is the idempotency
--     anchor — backfill is safe to re-run from any concurrent tab.
--   * `prev_close_value` is the prior trading day's mark-to-market value, kept
--     on the row so the daily chart can compute a daily delta in one query.
--     Monthly rows store 0 here (month chart doesn't need it).
--   * `prices_complete` is 0/1: 1 when every open position had a `prices`
--     row on `snapshot_date`; 0 when the day's mark is partial (e.g. user
--     traded into a new position after the close, or a symbol's TWSE row
--     was missing). The chart UI uses this to render a hollow marker.
--   * `realized_pl` is cumulative realized P&L *as of* snapshot_date — not
--     the realized change that day. Easier to chart; daily delta is the row
--     diff against the prior row.

CREATE TABLE IF NOT EXISTS pnl_snapshots (
  id                TEXT PRIMARY KEY,
  user_id           INTEGER NOT NULL,
  snapshot_date     TEXT NOT NULL,                -- YYYY-MM-DD
  granularity       TEXT NOT NULL CHECK(granularity IN ('D','M')),
  market_value      NUMERIC NOT NULL DEFAULT 0,    -- Σ(qty * close) on this date
  cash_balance      NUMERIC NOT NULL DEFAULT 0,    -- cumulative cash-flow net
  total_assets      NUMERIC NOT NULL DEFAULT 0,    -- market_value + cash_balance
  unrealized_pnl    NUMERIC NOT NULL DEFAULT 0,    -- Σ(qty * (close - avg_cost))
  realized_pl       NUMERIC NOT NULL DEFAULT 0,    -- cumulative realized as of date
  prev_close_value  NUMERIC NOT NULL DEFAULT 0,    -- mark-to-market on prior trading day
  prices_complete   INTEGER NOT NULL DEFAULT 0,    -- 0/1
  created_at        TEXT NOT NULL,
  UNIQUE(user_id, snapshot_date, granularity)
);

CREATE INDEX IF NOT EXISTS ix_pnl_snapshots_user_gran_date
  ON pnl_snapshots(user_id, granularity, snapshot_date);
