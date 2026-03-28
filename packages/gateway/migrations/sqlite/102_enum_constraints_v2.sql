-- tyrum:disable_foreign_keys
--
-- Tyrum Gateway schema v2 (SQLite) — enum constraints for stable status/kind columns.
--
-- Goal: align DB-level integrity with gateway-owned enums (and protect state machines
-- from typo values). This migration is written to be rolling-upgrade safe by
-- normalizing legacy/invalid stored values during the table rebuild.

-- ---------------------------------------------------------------------------
-- Plans / planner
-- ---------------------------------------------------------------------------

CREATE TABLE plans_next (
  tenant_id    TEXT NOT NULL,
  plan_id      TEXT NOT NULL,
  plan_key     TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  conversation_id   TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('audit','planner')),
  status       TEXT NOT NULL CHECK (status IN ('active','success','escalate','failure')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, plan_id),
  UNIQUE (tenant_id, plan_key),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, conversation_id) ON DELETE SET NULL
);

INSERT INTO plans_next (
  tenant_id,
  plan_id,
  plan_key,
  agent_id,
  workspace_id,
  conversation_id,
  kind,
  status,
  created_at,
  updated_at
)
SELECT
  tenant_id,
  plan_id,
  plan_key,
  agent_id,
  workspace_id,
  conversation_id,
  CASE
    WHEN kind IN ('audit','planner') THEN kind
    ELSE 'audit'
  END AS kind,
  CASE
    WHEN status IN ('active','success','escalate','failure') THEN status
    ELSE 'active'
  END AS status,
  created_at,
  updated_at
FROM plans;

DROP TABLE plans;
ALTER TABLE plans_next RENAME TO plans;

CREATE INDEX IF NOT EXISTS plans_tenant_plan_key_idx ON plans (tenant_id, plan_key);

-- ---------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------

CREATE TABLE approvals_next (
  tenant_id    TEXT NOT NULL,
  approval_id  TEXT NOT NULL,
  approval_key TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (
    kind IN (
      'spend',
      'pii',
      'workflow_step',
      'policy',
      'budget',
      'pairing',
      'takeover',
      'intent',
      'retry',
      'connector.send',
      'work.intervention',
      'other'
    )
  ),
  status       TEXT NOT NULL CHECK (status IN ('pending','approved','denied','expired','cancelled')),
  prompt       TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT,
  resolved_at  TEXT,
  resolution_json TEXT,
  conversation_id   TEXT,
  plan_id      TEXT,
  turn_id      TEXT,
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
  FOREIGN KEY (tenant_id, plan_id) REFERENCES plans(tenant_id, plan_id) ON DELETE SET NULL
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
  context_json,
  created_at,
  expires_at,
  resolved_at,
  resolution_json,
  conversation_id,
  plan_id,
  turn_id,
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
  CASE
    WHEN kind IN (
      'spend',
      'pii',
      'workflow_step',
      'policy',
      'budget',
      'pairing',
      'takeover',
      'intent',
      'retry',
      'connector.send',
      'work.intervention',
      'other'
    ) THEN kind
    ELSE 'other'
  END AS kind,
  CASE
    WHEN status IN ('pending','approved','denied','expired','cancelled') THEN status
    ELSE 'pending'
  END AS status,
  prompt,
  context_json,
  created_at,
  expires_at,
  resolved_at,
  resolution_json,
  conversation_id,
  plan_id,
  turn_id,
  step_id,
  attempt_id,
  work_item_id,
  work_item_task_id,
  resume_token
FROM approvals;

DROP TABLE approvals;
ALTER TABLE approvals_next RENAME TO approvals;

CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals (tenant_id, status);
CREATE INDEX IF NOT EXISTS approvals_expires_at_idx ON approvals (tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS approvals_conversation_id_idx ON approvals (tenant_id, conversation_id);
CREATE INDEX IF NOT EXISTS approvals_plan_id_idx ON approvals (tenant_id, plan_id);
