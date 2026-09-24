-- F-03 fix: per-IP and per-email rate limit on /auth/register.
-- Distinct from auth_rate_limits (failed login lockouts) and write_rate_limits
-- (per-user successful writes). This table counts register ATTEMPTS inside a
-- sliding window — successful or not — keyed by IP and by email separately.
CREATE TABLE IF NOT EXISTS register_rate_limits (
    scope TEXT NOT NULL,                -- 'ip' | 'email'
    scope_key TEXT NOT NULL,
    first_attempt_at TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (scope, scope_key)
);
