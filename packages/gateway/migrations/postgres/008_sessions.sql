CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  turns_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_updated_idx ON sessions (updated_at DESC);

