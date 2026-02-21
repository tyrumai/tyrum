-- policy_overrides.created_from_policy_snapshot_id should reference policy_snapshots.snapshot_id (UUID text).

CREATE TABLE policy_overrides__new (
  policy_override_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  agent_id TEXT NOT NULL,
  workspace_id TEXT,
  tool_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT,
  created_from_approval_id INTEGER,
  created_from_policy_snapshot_id TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  revoked_reason TEXT
);

INSERT INTO policy_overrides__new (
  policy_override_id,
  status,
  agent_id,
  workspace_id,
  tool_id,
  pattern,
  created_at,
  created_by,
  created_from_approval_id,
  created_from_policy_snapshot_id,
  expires_at,
  revoked_at,
  revoked_by,
  revoked_reason
)
SELECT
  policy_override_id,
  status,
  agent_id,
  workspace_id,
  tool_id,
  pattern,
  created_at,
  created_by,
  created_from_approval_id,
  created_from_policy_snapshot_id,
  expires_at,
  revoked_at,
  revoked_by,
  revoked_reason
FROM policy_overrides;

DROP TABLE policy_overrides;

ALTER TABLE policy_overrides__new RENAME TO policy_overrides;

CREATE INDEX IF NOT EXISTS idx_policy_overrides_agent_tool ON policy_overrides (agent_id, tool_id, status);

