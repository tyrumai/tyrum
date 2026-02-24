-- Durable editable routing rule state (routing configs).

CREATE TABLE IF NOT EXISTS routing_configs (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  reverted_from_revision INTEGER
);

CREATE INDEX IF NOT EXISTS routing_configs_created_at_idx ON routing_configs (created_at);
