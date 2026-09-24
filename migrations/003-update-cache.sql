-- Update Check cache (Settings → Maintenance → 檢查更新)
-- 避免對 GitHub Releases API 每 request 都打 (60 req/hr unauthenticated rate limit)。
-- 一個 user 點按鈕 → 後端 cache miss → fetch → 1 hr 內所有 user 共用同一份快取。

CREATE TABLE IF NOT EXISTS update_cache (
    endpoint TEXT PRIMARY KEY,
    etag TEXT,
    payload_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
