-- Policy overrides: durable operator-created rules that relax require_approval → allow
CREATE TABLE IF NOT EXISTS policy_overrides (
  policy_override_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  agent_id TEXT NOT NULL,
  workspace_id TEXT,
  tool_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  created_from_approval_id INTEGER,
  created_from_policy_snapshot_id INTEGER,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_policy_overrides_agent_tool
  ON policy_overrides (agent_id, tool_id, status);

-- Auth profiles: add agent_id column for multi-agent scoping
ALTER TABLE model_auth_profiles ADD COLUMN IF NOT EXISTS agent_id TEXT;
CREATE INDEX IF NOT EXISTS idx_auth_profiles_agent ON model_auth_profiles (agent_id);
