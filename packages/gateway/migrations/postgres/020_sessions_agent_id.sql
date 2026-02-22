-- Ensure sessions are isolated per agent.

-- Ensure compaction columns exist for upgraded databases.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS compacted_summary TEXT DEFAULT '';

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS compaction_count INTEGER DEFAULT 0;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_pkey;

ALTER TABLE sessions
  ADD PRIMARY KEY (session_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions (agent_id);
