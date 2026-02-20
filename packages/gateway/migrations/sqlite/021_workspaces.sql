-- Make workspace identity explicit (single default workspace initially).
-- `TYRUM_HOME` remains the workspace root; split/HA deployments mount the
-- appropriate workspace volume at `TYRUM_HOME` for ToolRunner jobs/pods.

ALTER TABLE sessions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS sessions_workspace_id_idx ON sessions (workspace_id);

ALTER TABLE approvals ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS approvals_workspace_id_idx ON approvals (workspace_id);

ALTER TABLE watchers ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS watchers_workspace_id_idx ON watchers (workspace_id);

ALTER TABLE execution_jobs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS execution_jobs_workspace_id_idx ON execution_jobs (workspace_id);

