CREATE TABLE IF NOT EXISTS context_reports (
  report_id  TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_context_reports_run_id ON context_reports(run_id);
