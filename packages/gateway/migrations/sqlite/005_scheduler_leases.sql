-- 023_scheduler_leases.sql
CREATE TABLE IF NOT EXISTS scheduler_leases (
  lease_name TEXT PRIMARY KEY,
  lease_owner TEXT NOT NULL,
  lease_expires_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS scheduler_leases_expires_at_idx ON scheduler_leases (lease_expires_at_ms);

-- 024_trigger_firings.sql
CREATE TABLE IF NOT EXISTS trigger_firings (
  firing_id TEXT PRIMARY KEY,
  watcher_id INTEGER NOT NULL,
  trigger_type TEXT NOT NULL,
  scheduled_at_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (watcher_id) REFERENCES watchers(id)
);

CREATE INDEX IF NOT EXISTS trigger_firings_watcher_id_idx ON trigger_firings (watcher_id);
CREATE INDEX IF NOT EXISTS trigger_firings_scheduled_at_ms_idx ON trigger_firings (scheduled_at_ms);

