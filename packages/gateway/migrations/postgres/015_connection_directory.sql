CREATE TABLE IF NOT EXISTS connection_directory (
  connection_id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  connected_at_ms BIGINT NOT NULL,
  last_seen_at_ms BIGINT NOT NULL,
  expires_at_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS connection_directory_edge_id_idx ON connection_directory (edge_id);
CREATE INDEX IF NOT EXISTS connection_directory_expires_at_ms_idx ON connection_directory (expires_at_ms);

