CREATE TABLE IF NOT EXISTS nodes (
  node_id TEXT PRIMARY KEY,
  label TEXT,
  capabilities TEXT NOT NULL DEFAULT '[]',
  pairing_status TEXT NOT NULL DEFAULT 'pending',
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT,
  resolved_by TEXT,
  resolution_reason TEXT,
  last_seen_at TEXT,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS node_capabilities (
  node_id TEXT NOT NULL REFERENCES nodes(node_id),
  capability TEXT NOT NULL,
  PRIMARY KEY (node_id, capability)
);
