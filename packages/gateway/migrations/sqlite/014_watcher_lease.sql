-- 014: Watcher scheduler lease + firing tracking table
ALTER TABLE watchers ADD COLUMN scheduler_owner TEXT;
ALTER TABLE watchers ADD COLUMN scheduler_lease_expires_at_ms INTEGER;
CREATE TABLE IF NOT EXISTS watcher_firings (
  firing_id TEXT PRIMARY KEY,
  watcher_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','enqueued','failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (watcher_id) REFERENCES watchers(id)
);
