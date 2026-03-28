ALTER TABLE subagents ADD COLUMN parent_conversation_key TEXT;

CREATE INDEX IF NOT EXISTS subagents_parent_conversation_key_idx
ON subagents (tenant_id, agent_id, workspace_id, parent_conversation_key, updated_at DESC);
