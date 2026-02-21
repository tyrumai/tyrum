-- 022_node_pairing.sql
CREATE TABLE IF NOT EXISTS node_pairings (
  pairing_id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'revoked')),
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  node_label TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  resolution_json TEXT,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS node_pairings_status_idx ON node_pairings (status);
CREATE INDEX IF NOT EXISTS node_pairings_node_id_idx ON node_pairings (node_id);

