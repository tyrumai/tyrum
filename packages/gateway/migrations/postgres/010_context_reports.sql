CREATE TABLE IF NOT EXISTS context_reports (
  report_id  TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL,
  report_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_context_reports_run_id ON context_reports(run_id);
