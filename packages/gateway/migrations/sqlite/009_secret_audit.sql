-- Secret resolution audit (SQLite)
-- Records secret handle resolutions without persisting raw secret values.

CREATE TABLE IF NOT EXISTS secret_resolutions (
  secret_resolution_id TEXT PRIMARY KEY,
  tool_call_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  handle_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  scope TEXT NOT NULL,
  agent_id TEXT,
  workspace_id TEXT,
  session_id TEXT,
  channel TEXT,
  thread_id TEXT,
  policy_snapshot_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('resolved', 'failed')),
  error TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS secret_resolutions_tool_call_handle_uniq
  ON secret_resolutions (tool_call_id, handle_id);

CREATE INDEX IF NOT EXISTS secret_resolutions_handle_id_idx ON secret_resolutions (handle_id);
CREATE INDEX IF NOT EXISTS secret_resolutions_occurred_at_idx ON secret_resolutions (occurred_at DESC);

