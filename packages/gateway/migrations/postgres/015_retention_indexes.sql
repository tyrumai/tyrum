-- 015: Retention indexes for efficient pruning queries
CREATE INDEX IF NOT EXISTS idx_artifact_metadata_created_at ON artifact_metadata(created_at);
CREATE INDEX IF NOT EXISTS idx_execution_runs_finished_at ON execution_runs(finished_at);
CREATE INDEX IF NOT EXISTS idx_outbox_created_at ON outbox(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
