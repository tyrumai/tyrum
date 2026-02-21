-- 011_policy_overrides.sql
-- Durable operator-created overrides that relax require_approval -> allow for matching tool actions.

CREATE TABLE IF NOT EXISTS policy_overrides (
  policy_override_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_json TEXT,
  agent_id TEXT NOT NULL,
  workspace_id TEXT,
  tool_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  created_from_approval_id INTEGER,
  created_from_policy_snapshot_id TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  revoked_by_json TEXT,
  revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS policy_overrides_agent_id_idx ON policy_overrides (agent_id);
CREATE INDEX IF NOT EXISTS policy_overrides_workspace_id_idx ON policy_overrides (workspace_id);
CREATE INDEX IF NOT EXISTS policy_overrides_tool_id_idx ON policy_overrides (tool_id);
CREATE INDEX IF NOT EXISTS policy_overrides_status_idx ON policy_overrides (status);
CREATE INDEX IF NOT EXISTS policy_overrides_expires_at_idx ON policy_overrides (expires_at);
CREATE INDEX IF NOT EXISTS policy_overrides_created_from_approval_idx ON policy_overrides (created_from_approval_id);

-- Extend approvals with approve-always metadata.
ALTER TABLE approvals ADD COLUMN response_mode TEXT;
ALTER TABLE approvals ADD COLUMN policy_override_id TEXT;
ALTER TABLE approvals ADD COLUMN resolved_by_json TEXT;

CREATE INDEX IF NOT EXISTS approvals_policy_override_id_idx ON approvals (policy_override_id);

