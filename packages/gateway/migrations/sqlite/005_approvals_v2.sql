-- Approvals v2 (execution-scoped approvals + resume tokens)

ALTER TABLE approvals ADD COLUMN kind TEXT NOT NULL DEFAULT 'other';
ALTER TABLE approvals ADD COLUMN agent_id TEXT;
ALTER TABLE approvals ADD COLUMN key TEXT;
ALTER TABLE approvals ADD COLUMN lane TEXT;
ALTER TABLE approvals ADD COLUMN run_id TEXT;
ALTER TABLE approvals ADD COLUMN resume_token TEXT;

CREATE INDEX IF NOT EXISTS approvals_kind_idx ON approvals (kind);
CREATE INDEX IF NOT EXISTS approvals_run_id_idx ON approvals (run_id);
CREATE INDEX IF NOT EXISTS approvals_agent_id_idx ON approvals (agent_id);
CREATE INDEX IF NOT EXISTS approvals_key_lane_idx ON approvals (key, lane);
