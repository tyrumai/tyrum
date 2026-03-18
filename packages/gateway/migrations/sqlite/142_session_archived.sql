ALTER TABLE sessions ADD COLUMN archived_at TEXT DEFAULT NULL;

CREATE INDEX idx_sessions_archived_at ON sessions (tenant_id, agent_id, workspace_id, archived_at);
