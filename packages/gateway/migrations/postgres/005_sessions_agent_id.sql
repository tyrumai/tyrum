-- Ensure sessions are isolated per agent.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_pkey;

ALTER TABLE sessions
  ADD PRIMARY KEY (session_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions (agent_id);

