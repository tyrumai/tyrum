-- Tyrum Gateway schema baseline (SQLite)
-- Squashed from migrations 001..023 (new installs only).

-- 001_planner_events.sql
CREATE TABLE IF NOT EXISTS planner_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  replay_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  step_index INTEGER NOT NULL CHECK(step_index >= 0),
  occurred_at TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(plan_id, step_index)
);

CREATE INDEX IF NOT EXISTS planner_events_plan_id_idx ON planner_events (plan_id);
CREATE INDEX IF NOT EXISTS planner_events_replay_id_idx ON planner_events (replay_id);

-- 002_memory_tables.sql
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS facts_subject_key_idx ON facts (subject_id, fact_key);
CREATE INDEX IF NOT EXISTS facts_subject_observed_idx ON facts (subject_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS episodic_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS episodic_events_subject_occurred_idx ON episodic_events (subject_id, occurred_at DESC);

-- 003_vector_embeddings.sql
CREATE TABLE IF NOT EXISTS vector_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  embedding_id TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  label TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(subject_id, embedding_id)
);

CREATE INDEX IF NOT EXISTS vector_metadata_subject_created_idx ON vector_metadata (subject_id, created_at DESC);

-- 004_capability_memories.sql
CREATE TABLE IF NOT EXISTS capability_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  capability_type TEXT NOT NULL,
  capability_identifier TEXT NOT NULL,
  executor_kind TEXT NOT NULL,
  selectors TEXT,
  outcome_metadata TEXT,
  cost_profile TEXT,
  anti_bot_notes TEXT,
  result_summary TEXT,
  success_count INTEGER NOT NULL DEFAULT 1,
  last_success_at TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(subject_id, capability_type, capability_identifier, executor_kind)
);

CREATE INDEX IF NOT EXISTS capability_memories_subject_type_idx ON capability_memories (subject_id, capability_type);

-- 005_profiles.sql
CREATE TABLE IF NOT EXISTS pam_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(subject_id, profile_id)
);

CREATE TABLE IF NOT EXISTS pvp_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(subject_id, profile_id)
);

-- 006_watchers.sql
CREATE TABLE IF NOT EXISTS watchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS watchers_subject_active_idx ON watchers (subject_id, active);
CREATE INDEX IF NOT EXISTS watchers_plan_id_idx ON watchers (plan_id);

-- 007_single_user_schema.sql
-- ---------------------------------------------------------------------------
-- facts
-- ---------------------------------------------------------------------------
ALTER TABLE facts RENAME TO facts_old;

CREATE TABLE facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO facts (id, fact_key, fact_value, source, observed_at, confidence, created_at)
SELECT id, fact_key, fact_value, source, observed_at, confidence, created_at
FROM facts_old;

DROP TABLE facts_old;

CREATE INDEX facts_key_idx ON facts (fact_key);
CREATE INDEX facts_observed_idx ON facts (observed_at DESC);

-- ---------------------------------------------------------------------------
-- episodic_events
-- ---------------------------------------------------------------------------
ALTER TABLE episodic_events RENAME TO episodic_events_old;

CREATE TABLE episodic_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO episodic_events (
  id,
  event_id,
  occurred_at,
  channel,
  event_type,
  payload,
  created_at
)
SELECT
  id,
  event_id,
  occurred_at,
  channel,
  event_type,
  payload,
  created_at
FROM episodic_events_old;

DROP TABLE episodic_events_old;

CREATE INDEX episodic_events_occurred_idx ON episodic_events (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- vector_metadata
-- ---------------------------------------------------------------------------
ALTER TABLE vector_metadata RENAME TO vector_metadata_old;

CREATE TABLE vector_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  embedding_id TEXT NOT NULL UNIQUE,
  embedding_model TEXT NOT NULL,
  label TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

WITH ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY embedding_id
      ORDER BY datetime(created_at) DESC, id DESC
    ) AS rn
  FROM vector_metadata_old
)
INSERT INTO vector_metadata (
  embedding_id,
  embedding_model,
  label,
  metadata,
  created_at
)
SELECT
  embedding_id,
  embedding_model,
  label,
  metadata,
  created_at
FROM ranked
WHERE rn = 1;

DROP TABLE vector_metadata_old;

CREATE INDEX vector_metadata_created_idx ON vector_metadata (created_at DESC);

-- ---------------------------------------------------------------------------
-- capability_memories
-- ---------------------------------------------------------------------------
ALTER TABLE capability_memories RENAME TO capability_memories_old;

CREATE TABLE capability_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capability_type TEXT NOT NULL,
  capability_identifier TEXT NOT NULL,
  executor_kind TEXT NOT NULL,
  selectors TEXT,
  outcome_metadata TEXT,
  cost_profile TEXT,
  anti_bot_notes TEXT,
  result_summary TEXT,
  success_count INTEGER NOT NULL DEFAULT 1,
  last_success_at TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(capability_type, capability_identifier, executor_kind)
);

WITH ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY capability_type, capability_identifier, executor_kind
      ORDER BY datetime(updated_at) DESC, id DESC
    ) AS rn
  FROM capability_memories_old
)
INSERT INTO capability_memories (
  capability_type,
  capability_identifier,
  executor_kind,
  selectors,
  outcome_metadata,
  cost_profile,
  anti_bot_notes,
  result_summary,
  success_count,
  last_success_at,
  metadata,
  created_at,
  updated_at
)
SELECT
  capability_type,
  capability_identifier,
  executor_kind,
  selectors,
  outcome_metadata,
  cost_profile,
  anti_bot_notes,
  result_summary,
  success_count,
  last_success_at,
  metadata,
  created_at,
  updated_at
FROM ranked
WHERE rn = 1;

DROP TABLE capability_memories_old;

CREATE INDEX capability_memories_type_idx ON capability_memories (capability_type);
CREATE INDEX capability_memories_success_idx ON capability_memories (last_success_at DESC);

-- ---------------------------------------------------------------------------
-- pam_profiles
-- ---------------------------------------------------------------------------
ALTER TABLE pam_profiles RENAME TO pam_profiles_old;

CREATE TABLE pam_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL UNIQUE,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

WITH ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY profile_id
      ORDER BY datetime(updated_at) DESC, id DESC
    ) AS rn
  FROM pam_profiles_old
)
INSERT INTO pam_profiles (
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
)
SELECT
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
FROM ranked
WHERE rn = 1;

DROP TABLE pam_profiles_old;

-- ---------------------------------------------------------------------------
-- pvp_profiles
-- ---------------------------------------------------------------------------
ALTER TABLE pvp_profiles RENAME TO pvp_profiles_old;

CREATE TABLE pvp_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL UNIQUE,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

WITH ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY profile_id
      ORDER BY datetime(updated_at) DESC, id DESC
    ) AS rn
  FROM pvp_profiles_old
)
INSERT INTO pvp_profiles (
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
)
SELECT
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
FROM ranked
WHERE rn = 1;

DROP TABLE pvp_profiles_old;

-- ---------------------------------------------------------------------------
-- watchers
-- ---------------------------------------------------------------------------
ALTER TABLE watchers RENAME TO watchers_old;

CREATE TABLE watchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO watchers (
  id,
  plan_id,
  trigger_type,
  trigger_config,
  active,
  created_at,
  updated_at
)
SELECT
  id,
  plan_id,
  trigger_type,
  trigger_config,
  active,
  created_at,
  updated_at
FROM watchers_old;

DROP TABLE watchers_old;

CREATE INDEX watchers_active_idx ON watchers (active);
CREATE INDEX watchers_plan_id_idx ON watchers (plan_id);

-- 008_sessions.sql
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  turns_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS sessions_updated_idx ON sessions (updated_at DESC);

-- 009_audit_hash_chain.sql
ALTER TABLE planner_events ADD COLUMN prev_hash TEXT;
ALTER TABLE planner_events ADD COLUMN event_hash TEXT;
ALTER TABLE episodic_events ADD COLUMN prev_hash TEXT;
ALTER TABLE episodic_events ADD COLUMN event_hash TEXT;

-- 010_approvals.sql
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT,
  response_reason TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS approvals_plan_id_idx ON approvals (plan_id);
CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals (status);
CREATE INDEX IF NOT EXISTS approvals_expires_at_idx ON approvals (expires_at);

-- 011_jobs.sql
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  action_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'paused', 'cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  result_json TEXT
);

CREATE INDEX IF NOT EXISTS jobs_plan_id_idx ON jobs (plan_id);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_plan_step_idx ON jobs (plan_id, step_index);

-- 012_canvas.sql
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

-- 013_vector_data.sql
ALTER TABLE vector_metadata ADD COLUMN vector_data TEXT;

-- 014_outbox.sql
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  target_edge_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS outbox_topic_idx ON outbox (topic);
CREATE INDEX IF NOT EXISTS outbox_target_edge_idx ON outbox (target_edge_id);

CREATE TABLE IF NOT EXISTS outbox_consumers (
  consumer_id TEXT PRIMARY KEY,
  last_outbox_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 015_connection_directory.sql
CREATE TABLE IF NOT EXISTS connection_directory (
  connection_id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  connected_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS connection_directory_edge_id_idx ON connection_directory (edge_id);
CREATE INDEX IF NOT EXISTS connection_directory_expires_at_ms_idx ON connection_directory (expires_at_ms);

-- 016_execution_engine.sql
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

-- 017_lane_leases.sql
CREATE TABLE IF NOT EXISTS lane_leases (
  key TEXT NOT NULL,
  lane TEXT NOT NULL,
  lease_owner TEXT NOT NULL,
  lease_expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (key, lane)
);

CREATE INDEX IF NOT EXISTS lane_leases_expires_at_idx ON lane_leases (lease_expires_at_ms);

-- 018_idempotency.sql
CREATE TABLE IF NOT EXISTS idempotency_records (
  scope_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (scope_key, kind, idempotency_key)
);

-- 019_resume_tokens.sql
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

-- 020_attempt_cost.sql
ALTER TABLE execution_attempts
ADD COLUMN cost_json TEXT;

-- 021_workspaces.sql
-- Make workspace identity explicit (single default workspace initially).
-- `TYRUM_HOME` remains the workspace root; split/HA deployments mount the
-- appropriate workspace volume at `TYRUM_HOME` for ToolRunner jobs/pods.

ALTER TABLE sessions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS sessions_workspace_id_idx ON sessions (workspace_id);

ALTER TABLE approvals ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS approvals_workspace_id_idx ON approvals (workspace_id);

ALTER TABLE watchers ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS watchers_workspace_id_idx ON watchers (workspace_id);

ALTER TABLE execution_jobs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS execution_jobs_workspace_id_idx ON execution_jobs (workspace_id);

-- 022_watcher_last_fired.sql
-- Cluster-safe watcher scheduling: persist last fire time in DB.
ALTER TABLE watchers ADD COLUMN last_fired_at_ms INTEGER;

CREATE INDEX IF NOT EXISTS watchers_last_fired_at_ms_idx ON watchers (last_fired_at_ms);

-- 023_workspace_leases.sql
CREATE TABLE IF NOT EXISTS workspace_leases (
  workspace_id TEXT NOT NULL PRIMARY KEY,
  lease_owner TEXT NOT NULL,
  lease_expires_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS workspace_leases_expires_at_idx ON workspace_leases (lease_expires_at_ms);
