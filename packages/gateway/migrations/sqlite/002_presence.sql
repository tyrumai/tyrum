-- Presence + device identity columns (SQLite)

-- Extend connection_directory with identity fields (additive).
ALTER TABLE connection_directory ADD COLUMN role TEXT NOT NULL DEFAULT 'client';
ALTER TABLE connection_directory ADD COLUMN device_id TEXT;
ALTER TABLE connection_directory ADD COLUMN pubkey TEXT;
ALTER TABLE connection_directory ADD COLUMN label TEXT;
ALTER TABLE connection_directory ADD COLUMN version TEXT;
ALTER TABLE connection_directory ADD COLUMN mode TEXT;

CREATE INDEX IF NOT EXISTS connection_directory_device_id_idx ON connection_directory (device_id);
CREATE INDEX IF NOT EXISTS connection_directory_role_idx ON connection_directory (role);

-- Durable-ish presence cache keyed by stable device identity (instance_id).
CREATE TABLE IF NOT EXISTS presence_entries (
  instance_id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  connection_id TEXT,
  host TEXT,
  ip TEXT,
  version TEXT,
  mode TEXT,
  last_input_seconds INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  connected_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS presence_entries_role_idx ON presence_entries (role);
CREATE INDEX IF NOT EXISTS presence_entries_last_seen_idx ON presence_entries (last_seen_at_ms DESC);
CREATE INDEX IF NOT EXISTS presence_entries_expires_at_ms_idx ON presence_entries (expires_at_ms);

