-- F-06 fix: per-user write rate limit.
-- Distinct from auth_rate_limits (which tracks FAILED logins + lock state).
-- This table counts SUCCESSFUL writes inside a fixed time window per user.
CREATE TABLE IF NOT EXISTS write_rate_limits (
    user_id INTEGER NOT NULL,
    window_started_at TEXT NOT NULL,
    write_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
