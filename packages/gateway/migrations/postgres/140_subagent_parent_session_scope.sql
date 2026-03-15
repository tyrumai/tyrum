ALTER TABLE subagents ADD COLUMN parent_session_key TEXT;

CREATE INDEX IF NOT EXISTS subagents_parent_session_scope_idx
ON subagents (tenant_id, agent_id, workspace_id, parent_session_key, updated_at DESC);
