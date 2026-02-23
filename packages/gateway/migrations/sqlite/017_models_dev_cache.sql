CREATE TABLE IF NOT EXISTS models_dev_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fetched_at TEXT NULL,
  etag TEXT NULL,
  sha256 TEXT NOT NULL,
  json TEXT NOT NULL,
  source TEXT NOT NULL,
  last_error TEXT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models_dev_refresh_leases (
  key TEXT PRIMARY KEY,
  lease_owner TEXT NOT NULL,
  lease_expires_at_ms INTEGER NOT NULL
);

