ALTER TABLE subagents ADD COLUMN IF NOT EXISTS desktop_environment_id TEXT;
ALTER TABLE subagents ADD COLUMN IF NOT EXISTS attached_node_id TEXT;

CREATE TABLE work_clarifications (
  tenant_id                 UUID NOT NULL,
  clarification_id          UUID NOT NULL,
  agent_id                  UUID NOT NULL,
  workspace_id              UUID NOT NULL,
  work_item_id              UUID NOT NULL,
  status                    TEXT NOT NULL CHECK (status IN ('open','answered','cancelled')),
  question                  TEXT NOT NULL,
  requested_by_subagent_id  UUID,
  requested_for_session_key TEXT NOT NULL,
  requested_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at               TIMESTAMPTZ,
  answer_text               TEXT,
  answered_by_session_key   TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, clarification_id),
  CONSTRAINT work_clarifications_membership_fk
    FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT work_clarifications_work_item_fk
    FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE CASCADE,
  CONSTRAINT work_clarifications_requested_by_subagent_fk
    FOREIGN KEY (tenant_id, requested_by_subagent_id)
    REFERENCES subagents(tenant_id, subagent_id) ON DELETE SET NULL
);

CREATE INDEX idx_work_clarifications_scope_updated
  ON work_clarifications (tenant_id, agent_id, workspace_id, updated_at DESC);

CREATE INDEX idx_work_clarifications_item_status
  ON work_clarifications (tenant_id, work_item_id, status, updated_at DESC);
