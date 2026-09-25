-- Migration 007: Per-user API tokens for multi-tenant security
-- Each user can generate/manage their own API tokens for integration.

CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    token_prefix TEXT NOT NULL,  -- First 8 chars for user identification, never shows full token
    purpose TEXT,                -- Optional description
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    expires_at TEXT NULL,        -- Optional expiry
    last_used_at TEXT NULL,
    CONSTRAINT chk_token_prefix CHECK (length(token_prefix) >= 4)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS ix_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS ix_api_tokens_token_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS ix_api_tokens_is_active ON api_tokens(is_active);

-- Token cannot be empty string (enforced by NOT NULL, but also app-level)