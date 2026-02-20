CREATE TABLE IF NOT EXISTS canvas_artifacts (
  id TEXT PRIMARY KEY,
  plan_id TEXT,
  title TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('text/html', 'text/plain')),
  html_content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS canvas_artifacts_plan_id_idx ON canvas_artifacts (plan_id);

