-- Ensure sessions are isolated per agent.

CREATE TABLE sessions__new (
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL DEFAULT 'default',
  channel TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  turns_json TEXT NOT NULL DEFAULT '[]',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  compacted_summary TEXT DEFAULT '',
  compaction_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, agent_id)
);

INSERT INTO sessions__new (
  session_id,
  agent_id,
  channel,
  thread_id,
  summary,
  turns_json,
  workspace_id,
  created_at,
  updated_at
)
SELECT
  session_id,
  'default',
  channel,
  thread_id,
  summary,
  turns_json,
  workspace_id,
  created_at,
  updated_at
FROM sessions;

DROP TABLE sessions;

ALTER TABLE sessions__new RENAME TO sessions;

CREATE INDEX IF NOT EXISTS sessions_updated_idx ON sessions (updated_at DESC);
CREATE INDEX IF NOT EXISTS sessions_workspace_id_idx ON sessions (workspace_id);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions (agent_id);
