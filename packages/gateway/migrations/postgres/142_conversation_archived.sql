ALTER TABLE conversations ADD COLUMN archived_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX idx_conversations_archived_at ON conversations (tenant_id, agent_id, workspace_id, archived_at);
