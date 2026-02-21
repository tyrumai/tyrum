-- 031_node_tokens.sql
CREATE TABLE IF NOT EXISTS node_tokens (
  token_id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  revoked_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS node_tokens_node_id_idx ON node_tokens (node_id);
CREATE INDEX IF NOT EXISTS node_tokens_revoked_at_idx ON node_tokens (revoked_at);

