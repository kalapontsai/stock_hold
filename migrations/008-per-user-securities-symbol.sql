-- 008-per-user-securities-symbol.sql
--
-- Background:
--   001-initial.sql created `securities` with `symbol TEXT NOT NULL UNIQUE`
--   (a single global UNIQUE on symbol).
--   002-users-and-tenant-columns.sql added `user_id` to every table to make
--   stock_hold multi-tenant, but did NOT change the securities.symbol UNIQUE.
--
--   That made symbol effectively a global namespace: once any user created
--   `0050`, no other user could create their own `0050`. Newly registered
--   users hit `409 CONFLICT — Symbol already exists` for every common TWSE
--   ticker, and the conflicting rows are invisible to them (the list query
--   filters by user_id), so there is no API-level workaround.
--
-- This migration rebuilds `securities` with `UNIQUE(user_id, symbol)` instead
-- of `UNIQUE(symbol)`. SQLite has no ALTER TABLE … DROP CONSTRAINT, so we use
-- the standard copy-rebuild pattern.
--
-- Behaviour after this migration:
--   * Each user gets their own `(user_id, symbol)` namespace — no more 409 for
--     new users on common tickers.
--   * Existing rows are preserved verbatim (same ids, same data). Foreign keys
--     from `transactions` / `positions` / `prices` / `dividends` continue to
--     point at the same row ids.
--   * Pre-002 legacy rows that still carry a NULL `user_id` will be copied
--     through. They are inaccessible through any user-scoped endpoint (every
--     query joins `WHERE s.user_id = ?`), so they stay dormant until a future
--     cleanup migration decides what to do with them.
--   * New rows inserted by the API always have a non-NULL `user_id` (set by
--     `current_user()`), so they participate in the new per-user UNIQUE.

-- NOTE: The bootstrap (api/bootstrap.php → apply_migrations) already wraps
-- each migration file in its own transaction. Do NOT add BEGIN/COMMIT here
-- or SQLite will throw "cannot start a transaction within a transaction".
-- Same goes for PRAGMA foreign_keys = OFF/ON — those pragmas are no-ops
-- while a transaction is in progress, so the rebuild runs with FKs ON.
-- The INSERT … SELECT below relies on existing securities.user_id values
-- being valid (set via the API which always uses current_user()), and on
-- NULL user_id rows (pre-002 legacy) being allowed by the FK definition.

CREATE TABLE securities_new (
    id        TEXT PRIMARY KEY,
    symbol    TEXT NOT NULL,
    exchange  TEXT NOT NULL DEFAULT 'TW',
    currency  TEXT NOT NULL DEFAULT 'TWD',
    name      TEXT NOT NULL,
    type      TEXT NOT NULL CHECK(type IN ('STOCK','ETF','FUND')),
    sector    TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, symbol)
);

INSERT INTO securities_new
    (id, symbol, exchange, currency, name, type, sector,
     is_active, created_at, updated_at, user_id)
SELECT
    id, symbol, exchange, currency, name, type, sector,
    is_active, created_at, updated_at, user_id
FROM securities;

DROP TABLE securities;
ALTER TABLE securities_new RENAME TO securities;

CREATE INDEX IF NOT EXISTS ix_securities_symbol   ON securities(symbol);
CREATE INDEX IF NOT EXISTS ix_securities_user_id ON securities(user_id);
