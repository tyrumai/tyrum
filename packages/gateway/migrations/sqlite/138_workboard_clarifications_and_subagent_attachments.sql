ALTER TABLE subagents ADD COLUMN desktop_environment_id TEXT;
ALTER TABLE subagents ADD COLUMN attached_node_id TEXT;

CREATE TABLE work_clarifications (
  tenant_id                 TEXT NOT NULL,
  clarification_id          TEXT NOT NULL,
  agent_id                  TEXT NOT NULL,
  workspace_id              TEXT NOT NULL,
  work_item_id              TEXT NOT NULL,
  status                    TEXT NOT NULL CHECK (status IN ('open','answered','cancelled')),
  question                  TEXT NOT NULL,
  requested_by_subagent_id  TEXT,
  requested_for_conversation_key TEXT NOT NULL,
  requested_at              TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at               TEXT,
  answer_text               TEXT,
  answered_by_conversation_key   TEXT,
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, clarification_id),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, requested_by_subagent_id)
    REFERENCES subagents(tenant_id, subagent_id) ON DELETE SET NULL
);

CREATE INDEX idx_work_clarifications_scope_updated
  ON work_clarifications (tenant_id, agent_id, workspace_id, updated_at DESC);

CREATE INDEX idx_work_clarifications_item_status
  ON work_clarifications (tenant_id, work_item_id, status, updated_at DESC);
