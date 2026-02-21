-- Node pairing (SQLite)

CREATE TABLE IF NOT EXISTS node_pairings (
  pairing_id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'revoked')),
  node_id TEXT NOT NULL UNIQUE,
  pubkey TEXT,
  label TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by_json TEXT,
  resolution_reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS node_pairings_status_idx ON node_pairings (status);
CREATE INDEX IF NOT EXISTS node_pairings_last_seen_at_idx ON node_pairings (last_seen_at);

