-- Ensure presence_entries timestamps have defaults (matches Postgres behavior).

CREATE TABLE presence_entries__new (
  client_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'client',
  node_id TEXT,
  agent_id TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  connected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  metadata_json TEXT
);

INSERT INTO presence_entries__new (
  client_id,
  role,
  node_id,
  agent_id,
  capabilities_json,
  connected_at,
  last_seen_at,
  metadata_json
)
SELECT
  client_id,
  role,
  node_id,
  agent_id,
  capabilities_json,
  connected_at,
  last_seen_at,
  metadata_json
FROM presence_entries;

DROP TABLE presence_entries;

ALTER TABLE presence_entries__new RENAME TO presence_entries;

