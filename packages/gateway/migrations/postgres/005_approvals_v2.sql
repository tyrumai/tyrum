-- Approvals v2 (execution-scoped approvals + resume tokens)

ALTER TABLE approvals ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'other';
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS agent_id TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS key TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS lane TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS run_id TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS resume_token TEXT;

CREATE INDEX IF NOT EXISTS approvals_kind_idx ON approvals (kind);
CREATE INDEX IF NOT EXISTS approvals_run_id_idx ON approvals (run_id);
CREATE INDEX IF NOT EXISTS approvals_agent_id_idx ON approvals (agent_id);
CREATE INDEX IF NOT EXISTS approvals_key_lane_idx ON approvals (key, lane);
