CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_users_locked_until ON users(locked_until);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
    scope_key TEXT PRIMARY KEY,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    window_started_at TEXT NOT NULL,
    locked_until TEXT NULL
);

-- Existing installations are single-tenant.  Columns are nullable during the
-- upgrade so the first successful registration can claim legacy rows safely.
ALTER TABLE accounts ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE securities ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE transactions ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE positions ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE prices ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE dividends ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE fx_rates ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE cash_balances ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS ix_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS ix_securities_user_id ON securities(user_id);
CREATE INDEX IF NOT EXISTS ix_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS ix_positions_user_id ON positions(user_id);
CREATE INDEX IF NOT EXISTS ix_prices_user_id ON prices(user_id);
CREATE INDEX IF NOT EXISTS ix_dividends_user_id ON dividends(user_id);
CREATE INDEX IF NOT EXISTS ix_fx_rates_user_id ON fx_rates(user_id);
CREATE INDEX IF NOT EXISTS ix_cash_balances_user_id ON cash_balances(user_id);
