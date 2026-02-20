-- Tyrum Gateway schema baseline (Postgres)
-- Squashed from migrations 001..023 (new installs only).

-- 001_planner_events.sql
CREATE TABLE IF NOT EXISTS planner_events (
  id BIGSERIAL PRIMARY KEY,
  replay_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  step_index INTEGER NOT NULL CHECK (step_index >= 0),
  occurred_at TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT planner_events_plan_step_unique UNIQUE (plan_id, step_index)
);

CREATE INDEX IF NOT EXISTS planner_events_plan_id_idx ON planner_events (plan_id);
CREATE INDEX IF NOT EXISTS planner_events_replay_id_idx ON planner_events (replay_id);

-- 002_memory_tables.sql
CREATE TABLE IF NOT EXISTS facts (
  id BIGSERIAL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS facts_subject_key_idx ON facts (subject_id, fact_key);
CREATE INDEX IF NOT EXISTS facts_subject_observed_idx ON facts (subject_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS episodic_events (
  id BIGSERIAL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS episodic_events_subject_occurred_idx ON episodic_events (subject_id, occurred_at DESC);

-- 003_vector_embeddings.sql
CREATE TABLE IF NOT EXISTS vector_metadata (
  id BIGSERIAL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  embedding_id TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  label TEXT,
  metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vector_metadata_subject_embedding_unique UNIQUE (subject_id, embedding_id)
);

CREATE INDEX IF NOT EXISTS vector_metadata_subject_created_idx ON vector_metadata (subject_id, created_at DESC);

-- 004_capability_memories.sql
CREATE TABLE IF NOT EXISTS capability_memories (
  id BIGSERIAL PRIMARY KEY,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT capability_memories_subject_unique UNIQUE (
    subject_id,
    capability_type,
    capability_identifier,
    executor_kind
  )
);

CREATE INDEX IF NOT EXISTS capability_memories_subject_type_idx ON capability_memories (subject_id, capability_type);

-- 005_profiles.sql
CREATE TABLE IF NOT EXISTS pam_profiles (
  id BIGSERIAL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pam_profiles_subject_profile_unique UNIQUE (subject_id, profile_id)
);

CREATE TABLE IF NOT EXISTS pvp_profiles (
  id BIGSERIAL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pvp_profiles_subject_profile_unique UNIQUE (subject_id, profile_id)
);

-- 006_watchers.sql
CREATE TABLE IF NOT EXISTS watchers (
  id BIGSERIAL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS watchers_subject_active_idx ON watchers (subject_id, active);
CREATE INDEX IF NOT EXISTS watchers_plan_id_idx ON watchers (plan_id);

-- 007_single_user_schema.sql
-- ---------------------------------------------------------------------------
-- facts
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS facts_subject_key_idx;
DROP INDEX IF EXISTS facts_subject_observed_idx;

ALTER TABLE facts DROP COLUMN IF EXISTS subject_id;

CREATE INDEX IF NOT EXISTS facts_key_idx ON facts (fact_key);
CREATE INDEX IF NOT EXISTS facts_observed_idx ON facts (observed_at DESC);

-- ---------------------------------------------------------------------------
-- episodic_events
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS episodic_events_subject_occurred_idx;

ALTER TABLE episodic_events DROP COLUMN IF EXISTS subject_id;

CREATE INDEX IF NOT EXISTS episodic_events_occurred_idx ON episodic_events (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- vector_metadata
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS vector_metadata_subject_created_idx;

ALTER TABLE vector_metadata DROP CONSTRAINT IF EXISTS vector_metadata_subject_embedding_unique;
ALTER TABLE vector_metadata DROP COLUMN IF EXISTS subject_id;
ALTER TABLE vector_metadata ADD CONSTRAINT vector_metadata_embedding_unique UNIQUE (embedding_id);

CREATE INDEX IF NOT EXISTS vector_metadata_created_idx ON vector_metadata (created_at DESC);

-- ---------------------------------------------------------------------------
-- capability_memories
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS capability_memories_subject_type_idx;

ALTER TABLE capability_memories DROP CONSTRAINT IF EXISTS capability_memories_subject_unique;
ALTER TABLE capability_memories DROP COLUMN IF EXISTS subject_id;
ALTER TABLE capability_memories ADD CONSTRAINT capability_memories_unique UNIQUE (
  capability_type,
  capability_identifier,
  executor_kind
);

CREATE INDEX IF NOT EXISTS capability_memories_type_idx ON capability_memories (capability_type);
CREATE INDEX IF NOT EXISTS capability_memories_success_idx ON capability_memories (last_success_at DESC);

-- ---------------------------------------------------------------------------
-- pam_profiles
-- ---------------------------------------------------------------------------
ALTER TABLE pam_profiles DROP CONSTRAINT IF EXISTS pam_profiles_subject_profile_unique;
ALTER TABLE pam_profiles DROP COLUMN IF EXISTS subject_id;
ALTER TABLE pam_profiles ADD CONSTRAINT pam_profiles_profile_unique UNIQUE (profile_id);

-- ---------------------------------------------------------------------------
-- pvp_profiles
-- ---------------------------------------------------------------------------
ALTER TABLE pvp_profiles DROP CONSTRAINT IF EXISTS pvp_profiles_subject_profile_unique;
ALTER TABLE pvp_profiles DROP COLUMN IF EXISTS subject_id;
ALTER TABLE pvp_profiles ADD CONSTRAINT pvp_profiles_profile_unique UNIQUE (profile_id);

-- ---------------------------------------------------------------------------
-- watchers
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS watchers_subject_active_idx;
DROP INDEX IF EXISTS watchers_plan_id_idx;

ALTER TABLE watchers DROP COLUMN IF EXISTS subject_id;

CREATE INDEX IF NOT EXISTS watchers_active_idx ON watchers (active);
CREATE INDEX IF NOT EXISTS watchers_plan_id_idx ON watchers (plan_id);

-- 008_sessions.sql
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

-- 009_audit_hash_chain.sql
ALTER TABLE planner_events ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE planner_events ADD COLUMN IF NOT EXISTS event_hash TEXT;
ALTER TABLE episodic_events ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE episodic_events ADD COLUMN IF NOT EXISTS event_hash TEXT;

-- 010_approvals.sql
CREATE TABLE IF NOT EXISTS approvals (
  id BIGSERIAL PRIMARY KEY,
  plan_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canvas_artifacts_plan_id_idx ON canvas_artifacts (plan_id);

-- 013_vector_data.sql
ALTER TABLE vector_metadata ADD COLUMN IF NOT EXISTS vector_data TEXT;

-- 014_outbox.sql
CREATE TABLE IF NOT EXISTS outbox (
  id BIGSERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  target_edge_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbox_topic_idx ON outbox (topic);
CREATE INDEX IF NOT EXISTS outbox_target_edge_idx ON outbox (target_edge_id);

CREATE TABLE IF NOT EXISTS outbox_consumers (
  consumer_id TEXT PRIMARY KEY,
  last_outbox_id BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 015_connection_directory.sql
CREATE TABLE IF NOT EXISTS connection_directory (
  connection_id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  connected_at_ms BIGINT NOT NULL,
  last_seen_at_ms BIGINT NOT NULL,
  expires_at_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS connection_directory_edge_id_idx ON connection_directory (edge_id);
CREATE INDEX IF NOT EXISTS connection_directory_expires_at_ms_idx ON connection_directory (expires_at_ms);

-- 016_execution_engine.sql
CREATE TABLE IF NOT EXISTS execution_jobs (
  job_id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  lane TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  paused_reason TEXT,
  paused_detail TEXT,
  CONSTRAINT execution_runs_job_fk FOREIGN KEY (job_id) REFERENCES execution_jobs(job_id)
);

CREATE INDEX IF NOT EXISTS execution_runs_job_id_idx ON execution_runs (job_id);
CREATE INDEX IF NOT EXISTS execution_runs_status_idx ON execution_runs (status);

CREATE TABLE IF NOT EXISTS execution_steps (
  step_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL CHECK (step_index >= 0),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled', 'skipped')),
  action_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT,
  postcondition_json TEXT,
  approval_id INTEGER,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  CONSTRAINT execution_steps_run_fk FOREIGN KEY (run_id) REFERENCES execution_runs(run_id),
  CONSTRAINT execution_steps_run_step_unique UNIQUE (run_id, step_index)
);

CREATE INDEX IF NOT EXISTS execution_steps_run_id_idx ON execution_steps (run_id);
CREATE INDEX IF NOT EXISTS execution_steps_status_idx ON execution_steps (status);

CREATE TABLE IF NOT EXISTS execution_attempts (
  attempt_id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'timed_out', 'cancelled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  result_json TEXT,
  error TEXT,
  postcondition_report_json TEXT,
  artifacts_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT,
  lease_owner TEXT,
  lease_expires_at_ms BIGINT,
  CONSTRAINT execution_attempts_step_fk FOREIGN KEY (step_id) REFERENCES execution_steps(step_id),
  CONSTRAINT execution_attempts_step_attempt_unique UNIQUE (step_id, attempt)
);

CREATE INDEX IF NOT EXISTS execution_attempts_step_id_idx ON execution_attempts (step_id);
CREATE INDEX IF NOT EXISTS execution_attempts_lease_idx ON execution_attempts (status, lease_expires_at_ms);

-- 017_lane_leases.sql
CREATE TABLE IF NOT EXISTS lane_leases (
  key TEXT NOT NULL,
  lane TEXT NOT NULL,
  lease_owner TEXT NOT NULL,
  lease_expires_at_ms BIGINT NOT NULL,
  CONSTRAINT lane_leases_pk PRIMARY KEY (key, lane)
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_records_pk PRIMARY KEY (scope_key, kind, idempotency_key)
);

-- 019_resume_tokens.sql
CREATE TABLE IF NOT EXISTS resume_tokens (
  token TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT resume_tokens_run_fk FOREIGN KEY (run_id) REFERENCES execution_runs(run_id)
);

CREATE INDEX IF NOT EXISTS resume_tokens_run_id_idx ON resume_tokens (run_id);
CREATE INDEX IF NOT EXISTS resume_tokens_expires_at_idx ON resume_tokens (expires_at);

-- 020_attempt_cost.sql
ALTER TABLE execution_attempts
ADD COLUMN IF NOT EXISTS cost_json TEXT;

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
ALTER TABLE watchers ADD COLUMN IF NOT EXISTS last_fired_at_ms BIGINT;

CREATE INDEX IF NOT EXISTS watchers_last_fired_at_ms_idx ON watchers (last_fired_at_ms);

-- 023_workspace_leases.sql
CREATE TABLE IF NOT EXISTS workspace_leases (
  workspace_id TEXT PRIMARY KEY,
  lease_owner TEXT NOT NULL,
  lease_expires_at_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS workspace_leases_expires_at_idx ON workspace_leases (lease_expires_at_ms);
