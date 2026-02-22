-- Policy snapshots + policy overrides (SQLite)

CREATE TABLE IF NOT EXISTS policy_snapshots (
  policy_snapshot_id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS policy_snapshots_sha256_idx ON policy_snapshots (sha256);

CREATE TABLE IF NOT EXISTS policy_overrides (
  policy_override_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  agent_id TEXT NOT NULL,
  workspace_id TEXT,
  tool_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  created_from_approval_id INTEGER,
  created_from_policy_snapshot_id TEXT,
  created_by_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT,
  revoked_at TEXT,
  revoked_by_json TEXT,
  revoked_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS policy_overrides_status_idx ON policy_overrides (status);
CREATE INDEX IF NOT EXISTS policy_overrides_agent_tool_idx ON policy_overrides (agent_id, tool_id);
CREATE INDEX IF NOT EXISTS policy_overrides_workspace_id_idx ON policy_overrides (workspace_id);
CREATE INDEX IF NOT EXISTS policy_overrides_created_from_approval_id_idx ON policy_overrides (created_from_approval_id);

ALTER TABLE execution_jobs ADD COLUMN policy_snapshot_id TEXT;
CREATE INDEX IF NOT EXISTS execution_jobs_policy_snapshot_id_idx ON execution_jobs (policy_snapshot_id);

ALTER TABLE execution_runs ADD COLUMN policy_snapshot_id TEXT;
CREATE INDEX IF NOT EXISTS execution_runs_policy_snapshot_id_idx ON execution_runs (policy_snapshot_id);

