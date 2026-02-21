-- 030_context_reports.sql
CREATE TABLE IF NOT EXISTS context_reports (
  context_report_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL UNIQUE,
  session_id TEXT,
  run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  report_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS context_reports_created_at_idx ON context_reports (created_at);
CREATE INDEX IF NOT EXISTS context_reports_plan_id_idx ON context_reports (plan_id);
CREATE INDEX IF NOT EXISTS context_reports_session_id_idx ON context_reports (session_id);
CREATE INDEX IF NOT EXISTS context_reports_run_id_idx ON context_reports (run_id);

