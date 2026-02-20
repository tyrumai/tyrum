CREATE TABLE IF NOT EXISTS execution_jobs (
  job_id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  lane TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  trigger_json TEXT NOT NULL,
  input_json TEXT,
  latest_run_id TEXT
);

CREATE INDEX IF NOT EXISTS execution_jobs_key_lane_idx ON execution_jobs (key, lane);
CREATE INDEX IF NOT EXISTS execution_jobs_status_idx ON execution_jobs (status);

CREATE TABLE IF NOT EXISTS execution_runs (
  run_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  key TEXT NOT NULL,
  lane TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')),
  attempt INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT,
  paused_reason TEXT,
  paused_detail TEXT,
  FOREIGN KEY (job_id) REFERENCES execution_jobs(job_id)
);

CREATE INDEX IF NOT EXISTS execution_runs_job_id_idx ON execution_runs (job_id);
CREATE INDEX IF NOT EXISTS execution_runs_status_idx ON execution_runs (status);

CREATE TABLE IF NOT EXISTS execution_steps (
  step_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL CHECK(step_index >= 0),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled', 'skipped')),
  action_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  idempotency_key TEXT,
  postcondition_json TEXT,
  approval_id INTEGER,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  FOREIGN KEY (run_id) REFERENCES execution_runs(run_id),
  UNIQUE (run_id, step_index)
);

CREATE INDEX IF NOT EXISTS execution_steps_run_id_idx ON execution_steps (run_id);
CREATE INDEX IF NOT EXISTS execution_steps_status_idx ON execution_steps (status);

CREATE TABLE IF NOT EXISTS execution_attempts (
  attempt_id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK(attempt >= 1),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'timed_out', 'cancelled')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  result_json TEXT,
  error TEXT,
  postcondition_report_json TEXT,
  artifacts_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT,
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  FOREIGN KEY (step_id) REFERENCES execution_steps(step_id),
  UNIQUE (step_id, attempt)
);

CREATE INDEX IF NOT EXISTS execution_attempts_step_id_idx ON execution_attempts (step_id);
CREATE INDEX IF NOT EXISTS execution_attempts_lease_idx ON execution_attempts (status, lease_expires_at_ms);

