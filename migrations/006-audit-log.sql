-- F-07 fix: append-only audit trail for all authenticated mutations.
-- One row per call to require_write_access (and any finer-grained calls
-- from individual handlers). Failures must NOT break the request — the
-- helper swallows exceptions and logs to stderr.
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    ip TEXT,
    ts TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_audit_log_user_ts ON audit_log(user_id, ts);
