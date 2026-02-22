-- Add optional execution context columns to approvals table
ALTER TABLE approvals ADD COLUMN run_id TEXT;
ALTER TABLE approvals ADD COLUMN step_id TEXT;
ALTER TABLE approvals ADD COLUMN attempt_id TEXT;
ALTER TABLE approvals ADD COLUMN resume_token TEXT;

CREATE INDEX IF NOT EXISTS idx_approvals_run_id ON approvals(run_id);
