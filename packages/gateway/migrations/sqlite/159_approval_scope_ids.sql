-- tyrum:disable_foreign_keys
--
-- Add turn-item and workflow-run-step approval scope identifiers while keeping
-- the legacy execution-step columns until the runtime cutover lands.

CREATE TABLE approvals_next (
  tenant_id    TEXT NOT NULL,
  approval_id  TEXT NOT NULL,
  approval_key TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (
    kind IN (
      'workflow_step',
      'policy',
      'budget',
      'takeover',
      'intent',
      'retry',
      'connector.send',
      'work.intervention'
    )
  ),
  status       TEXT NOT NULL CHECK (
    status IN (
      'queued',
      'reviewing',
      'awaiting_human',
      'approved',
      'denied',
      'expired',
      'cancelled'
    )
  ),
  prompt       TEXT NOT NULL,
  motivation   TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT,
  latest_review_id TEXT,
  conversation_id   TEXT,
  plan_id      TEXT,
  turn_id      TEXT,
  turn_item_id TEXT,
  workflow_run_step_id TEXT,
  step_id      TEXT,
  attempt_id   TEXT,
  work_item_id TEXT,
  work_item_task_id TEXT,
  resume_token TEXT,
  PRIMARY KEY (tenant_id, approval_id),
  UNIQUE (tenant_id, approval_key),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, conversation_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, plan_id) REFERENCES plans(tenant_id, plan_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, turn_id) REFERENCES turns(tenant_id, turn_id),
  FOREIGN KEY (tenant_id, turn_item_id) REFERENCES turn_items(tenant_id, turn_item_id),
  FOREIGN KEY (tenant_id, workflow_run_step_id)
    REFERENCES workflow_run_steps(tenant_id, workflow_run_step_id),
  FOREIGN KEY (tenant_id, step_id) REFERENCES execution_steps(tenant_id, step_id),
  FOREIGN KEY (tenant_id, attempt_id) REFERENCES execution_attempts(tenant_id, attempt_id),
  FOREIGN KEY (tenant_id, latest_review_id)
    REFERENCES review_entries(tenant_id, review_id) ON DELETE SET NULL
);

INSERT INTO approvals_next (
  tenant_id,
  approval_id,
  approval_key,
  agent_id,
  workspace_id,
  kind,
  status,
  prompt,
  motivation,
  context_json,
  created_at,
  expires_at,
  latest_review_id,
  conversation_id,
  plan_id,
  turn_id,
  turn_item_id,
  workflow_run_step_id,
  step_id,
  attempt_id,
  work_item_id,
  work_item_task_id,
  resume_token
)
SELECT
  tenant_id,
  approval_id,
  approval_key,
  agent_id,
  workspace_id,
  kind,
  status,
  prompt,
  motivation,
  context_json,
  created_at,
  expires_at,
  latest_review_id,
  conversation_id,
  plan_id,
  CASE
    WHEN turn_id IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1
      FROM turns
      WHERE turns.tenant_id = approvals.tenant_id
        AND turns.turn_id = approvals.turn_id
    ) THEN turn_id
    ELSE NULL
  END AS turn_id,
  NULL AS turn_item_id,
  NULL AS workflow_run_step_id,
  CASE
    WHEN step_id IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1
      FROM execution_steps
      WHERE execution_steps.tenant_id = approvals.tenant_id
        AND execution_steps.step_id = approvals.step_id
    ) THEN step_id
    ELSE NULL
  END AS step_id,
  CASE
    WHEN attempt_id IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1
      FROM execution_attempts
      WHERE execution_attempts.tenant_id = approvals.tenant_id
        AND execution_attempts.attempt_id = approvals.attempt_id
    ) THEN attempt_id
    ELSE NULL
  END AS attempt_id,
  work_item_id,
  work_item_task_id,
  resume_token
FROM approvals;

DROP TABLE approvals;
ALTER TABLE approvals_next RENAME TO approvals;

CREATE INDEX approvals_status_idx ON approvals (tenant_id, status);
CREATE INDEX approvals_expires_at_idx ON approvals (tenant_id, expires_at);
CREATE INDEX approvals_conversation_id_idx ON approvals (tenant_id, conversation_id);
CREATE INDEX approvals_plan_id_idx ON approvals (tenant_id, plan_id);
