-- Context reports (SQLite)
-- Durable "what the model saw" metadata, persisted per agent run/turn.

CREATE TABLE IF NOT EXISTS context_reports (
  context_report_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  agent_id TEXT NOT NULL DEFAULT 'default',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  run_id TEXT,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS context_reports_session_id_idx ON context_reports (session_id);
CREATE INDEX IF NOT EXISTS context_reports_created_at_idx ON context_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS context_reports_run_id_idx ON context_reports (run_id);

