-- stock_hold 2.3.1 — Prices `source` column for historical imports.
--
-- Why:
--   The P&L snapshot backfill (api/_pnl.php) needs to backfill missing
--   trading days by pulling historical closes from the configured
--   provider. Those historical bars are NOT "live" quotes — they were
--   fetched in bulk, possibly with a delay, and may have been re-checked
--   by a live fetch later. The UI wants to tell the two apart so the
--   user knows which dots on the equity curve are real-time and which
--   are historical reconstructions.
--
-- Values:
--   'live'             — set by /prices/batch-update (today + yesterday)
--   'historical_import'— set by api/_pnl_history.php during backfill
--
-- Migration is additive: defaults to 'live' so every existing row is
-- interpreted as a live quote (which is what it actually is today).

ALTER TABLE prices
  ADD COLUMN source TEXT NOT NULL DEFAULT 'live'
    CHECK(source IN ('live','historical_import'));

CREATE INDEX IF NOT EXISTS ix_prices_source
  ON prices(user_id, source);
