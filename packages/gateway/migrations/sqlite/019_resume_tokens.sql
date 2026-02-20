CREATE TABLE IF NOT EXISTS resume_tokens (
  token TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (run_id) REFERENCES execution_runs(run_id)
);

CREATE INDEX IF NOT EXISTS resume_tokens_run_id_idx ON resume_tokens (run_id);
CREATE INDEX IF NOT EXISTS resume_tokens_expires_at_idx ON resume_tokens (expires_at);

