-- Add agent_id column to stateful tables with default value 'default'.
-- When TYRUM_MULTI_AGENT is off (default), all rows use 'default'.

ALTER TABLE facts ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE episodic_events ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE capability_memories ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE approvals ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE execution_jobs ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE execution_runs ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE artifact_metadata ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default';

-- Indexes for agent-scoped queries
CREATE INDEX IF NOT EXISTS idx_facts_agent ON facts(agent_id);
CREATE INDEX IF NOT EXISTS idx_episodic_events_agent ON episodic_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_capability_memories_agent ON capability_memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_approvals_agent ON approvals(agent_id);
CREATE INDEX IF NOT EXISTS idx_execution_jobs_agent ON execution_jobs(agent_id);
CREATE INDEX IF NOT EXISTS idx_execution_runs_agent ON execution_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_artifact_metadata_agent ON artifact_metadata(agent_id);
