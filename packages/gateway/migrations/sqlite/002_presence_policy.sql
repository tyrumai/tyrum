-- 020_presence.sql
CREATE TABLE IF NOT EXISTS presence_entries (
  instance_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('gateway', 'client', 'node')),
  host TEXT,
  ip TEXT,
  version TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('ui', 'web', 'cli', 'node', 'backend', 'probe', 'test')),
  last_seen_at TEXT NOT NULL,
  last_input_seconds INTEGER,
  reason TEXT NOT NULL CHECK (reason IN ('self', 'connect', 'periodic', 'node-connected'))
);

CREATE INDEX IF NOT EXISTS presence_entries_last_seen_at_idx ON presence_entries (last_seen_at);

-- 021_policy_bundle.sql
CREATE TABLE IF NOT EXISTS policy_bundles (
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('deployment', 'agent', 'playbook')),
  scope_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  format TEXT NOT NULL CHECK (format IN ('json', 'yaml')),
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (scope_kind, scope_id)
);

CREATE INDEX IF NOT EXISTS policy_bundles_hash_idx ON policy_bundles (content_hash);

CREATE TABLE IF NOT EXISTS policy_snapshots (
  policy_snapshot_id TEXT PRIMARY KEY,
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  sources_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS policy_snapshots_hash_unique ON policy_snapshots (content_hash);

ALTER TABLE execution_runs ADD COLUMN policy_snapshot_id TEXT;
ALTER TABLE execution_runs ADD COLUMN policy_snapshot_hash TEXT;

CREATE INDEX IF NOT EXISTS execution_runs_policy_snapshot_id_idx ON execution_runs (policy_snapshot_id);

