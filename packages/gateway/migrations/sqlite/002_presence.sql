CREATE TABLE IF NOT EXISTS presence_entries (
  client_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'client',
  node_id TEXT,
  agent_id TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  connected_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  metadata_json TEXT
);
