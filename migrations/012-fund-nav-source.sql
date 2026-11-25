-- stock_hold 2.5.0 — Fund NAV (單位淨值) quote source for 基金 / 連結基金
--
-- Background:
--   securities.type already allows 'FUND', but a fund unit is NOT an
--   exchange-listed ticker: it has no TWSE/TPEx symbol that MIS / FinMind /
--   Yahoo can resolve. Every quote provider therefore fails on such a
--   symbol, the prices table stays empty for it, and the holdings view
--   renders 現價 = 0 → 市值 = 0 → 未實現損益 meaningless.
--
--   A Taiwan fund unit is priced by its 單位淨值 (NAV), published once per
--   business day by the fund house (元大/國泰/群益/...). NAV lives in a
--   different namespace than a ticker: 元大's fund id (1250) or ISIN
--   (TW000T05B2C2), not 0050.
--
--   Migration 011 added prices.source for historical imports. NAV rows
--   are neither 'live' nor 'historical_import' — they are the official
--   published unit value for a given date. We add a third source value
--   'fund_nav' so the UI/P&L code can tell a NAV print apart from a
--   market quote.
--
-- Changes:
--   1. prices.source gains 'fund_nav'. The CHECK constraint cannot be
--      altered in place, so this uses the same copy-rebuild pattern that
--      migration 008 used for securities. All existing rows are copied
--      verbatim; ids, unique(security_id,date) and both indexes are
--      restored.
--   2. securities.nav_source — which issuer's NAV feed to use for this
--      security ('yuanta' today; NULL means "not a NAV-priced fund",
--      i.e. keep using the normal market quote providers).
--   3. securities.nav_code — the issuer-side identifier of the exact
--      fund unit (元大 fund id, e.g. '1250'). Kept as TEXT because other
--      issuers key on ISIN or a ticker instead of a numeric id.
--
-- Why not per-fund scraping scripts / ActiveX:
--   The NAV feed is a stable JSON API on the issuer side
--   (api.yuantafunds.com/ectranslation/api/trans, FuncId=FundNAV). One
--   adapter covers every fund that issuer publishes, so adding a fund is
--   a data row, not a new program. ActiveX additionally cannot run on
--   the Linux/Apache deployment this app ships on.
--
-- The bootstrap (api/bootstrap.php → apply_migrations) already wraps each
-- migration file in its own transaction. Do NOT add BEGIN/COMMIT here.

CREATE TABLE prices_new (
    id        TEXT PRIMARY KEY,
    security_id TEXT NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
    date      TEXT NOT NULL,
    open      NUMERIC NOT NULL,
    high      NUMERIC NOT NULL,
    low       NUMERIC NOT NULL,
    close     NUMERIC NOT NULL,
    volume    NUMERIC NOT NULL DEFAULT 0,
    currency  TEXT NOT NULL DEFAULT 'TWD',
    created_at TEXT NOT NULL,
    user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
    source    TEXT NOT NULL DEFAULT 'live'
        CHECK(source IN ('live','historical_import','fund_nav')),
    UNIQUE(security_id,date)
);

INSERT INTO prices_new
    (id,security_id,date,open,high,low,close,volume,currency,created_at,user_id,source)
SELECT
    id,security_id,date,open,high,low,close,volume,currency,created_at,user_id,source
FROM prices;

DROP TABLE prices;

ALTER TABLE prices_new RENAME TO prices;

CREATE INDEX IF NOT EXISTS ix_prices_user_id ON prices(user_id);
CREATE INDEX IF NOT EXISTS ix_prices_source  ON prices(user_id, source);

-- NAV feed selection per security. NULL nav_source = normal market quote.
ALTER TABLE securities ADD COLUMN nav_source TEXT;
ALTER TABLE securities ADD COLUMN nav_code  TEXT;

CREATE INDEX IF NOT EXISTS ix_securities_nav_source ON securities(user_id, nav_source);
