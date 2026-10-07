-- 009-extension-api-keys.sql
--
-- Background:
--   The api_tokens table (migration 007) holds stock_hold's own per-user
--   authentication tokens. Those tokens are HASHED (sha256) and the raw
--   value is shown to the user exactly once. They are NOT a credential
--   stock_hold uses to call other services.
--
--   With the upcoming Fubon Neo API integration we need the inverse shape:
--   a per-user credential stock_hold USES to call an external provider
--   (Fubon, future brokers, …). The plaintext is needed at query time, so
--   we store it encrypted with a key derived from a server-side secret,
--   and never expose it through the API after the initial write.
--
-- Schema notes:
--   * (user_id, provider) is unique — one credential per provider per user.
--     Re-submitting a key for the same provider REPLACES the existing row
--     (server uses INSERT … ON CONFLICT … DO UPDATE).
--   * key_ciphertext / key_iv store the AES-256-CBC ciphertext + IV (both
--     hex). Plaintext never lands in SQLite.
--   * key_prefix mirrors the first 8 chars of the plaintext so the user
--     can identify which key is stored (same UX as api_tokens).
--   * updated_at is bumped on every upsert so we can show "last set".
--
-- Provider values today: 'fubon_api_key'. The allowed list lives in
-- POST /extension-keys/upsert and is the single source of truth; this
-- migration only defines the storage shape.

CREATE TABLE IF NOT EXISTS extension_api_keys (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider        TEXT    NOT NULL,
    key_ciphertext  TEXT    NOT NULL,
    key_iv          TEXT    NOT NULL,
    key_prefix      TEXT    NOT NULL,
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL,
    UNIQUE (user_id, provider),
    CONSTRAINT chk_extension_provider CHECK (length(provider) > 3),
    CONSTRAINT chk_extension_prefix   CHECK (length(key_prefix) >= 4)
);

CREATE INDEX IF NOT EXISTS ix_extension_api_keys_user_provider ON extension_api_keys (user_id, provider);