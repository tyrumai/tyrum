-- Allow approvals.status = 'cancelled' (align DB CHECK with types/schemas).

ALTER TABLE approvals RENAME TO approvals_old;

CREATE TABLE approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT,
  response_reason TEXT,
  expires_at TEXT,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL DEFAULT 'other',
  agent_id TEXT,
  key TEXT,
  lane TEXT,
  run_id TEXT,
  resume_token TEXT
);

INSERT INTO approvals (
  id,
  plan_id,
  step_index,
  prompt,
  context_json,
  status,
  created_at,
  responded_at,
  response_reason,
  expires_at,
  workspace_id,
  kind,
  agent_id,
  key,
  lane,
  run_id,
  resume_token
)
SELECT
  id,
  plan_id,
  step_index,
  prompt,
  context_json,
  status,
  created_at,
  responded_at,
  response_reason,
  expires_at,
  workspace_id,
  kind,
  agent_id,
  key,
  lane,
  run_id,
  resume_token
FROM approvals_old;

DROP TABLE approvals_old;

CREATE INDEX IF NOT EXISTS approvals_plan_id_idx ON approvals (plan_id);
CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals (status);
CREATE INDEX IF NOT EXISTS approvals_expires_at_idx ON approvals (expires_at);
CREATE INDEX IF NOT EXISTS approvals_workspace_id_idx ON approvals (workspace_id);
CREATE INDEX IF NOT EXISTS approvals_kind_idx ON approvals (kind);
CREATE INDEX IF NOT EXISTS approvals_run_id_idx ON approvals (run_id);
CREATE INDEX IF NOT EXISTS approvals_agent_id_idx ON approvals (agent_id);
CREATE INDEX IF NOT EXISTS approvals_key_lane_idx ON approvals (key, lane);
