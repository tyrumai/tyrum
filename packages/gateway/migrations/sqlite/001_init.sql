-- Tyrum Gateway schema (SQLite)
-- Single squashed baseline – app has never been deployed.

--------------------------------------------------------------------------------
-- planner_events
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS planner_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  replay_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  step_index INTEGER NOT NULL CHECK(step_index >= 0),
  occurred_at TEXT NOT NULL,
  action TEXT NOT NULL,
  prev_hash TEXT,
  event_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(plan_id, step_index)
);

CREATE INDEX IF NOT EXISTS planner_events_plan_id_idx ON planner_events (plan_id);
CREATE INDEX IF NOT EXISTS planner_events_replay_id_idx ON planner_events (replay_id);

--------------------------------------------------------------------------------
-- facts
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  agent_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS facts_key_idx ON facts (fact_key);
CREATE INDEX IF NOT EXISTS facts_observed_idx ON facts (observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_facts_agent ON facts (agent_id);

--------------------------------------------------------------------------------
-- episodic_events
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS episodic_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  prev_hash TEXT,
  event_hash TEXT,
  agent_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS episodic_events_occurred_idx ON episodic_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_episodic_events_agent ON episodic_events (agent_id);

--------------------------------------------------------------------------------
-- vector_metadata
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vector_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  embedding_id TEXT NOT NULL UNIQUE,
  embedding_model TEXT NOT NULL,
  label TEXT,
  metadata TEXT,
  vector_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS vector_metadata_created_idx ON vector_metadata (created_at DESC);

--------------------------------------------------------------------------------
-- capability_memories
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS capability_memories (
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
  agent_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(capability_type, capability_identifier, executor_kind)
);

CREATE INDEX IF NOT EXISTS capability_memories_type_idx ON capability_memories (capability_type);
CREATE INDEX IF NOT EXISTS capability_memories_success_idx ON capability_memories (last_success_at DESC);
CREATE INDEX IF NOT EXISTS idx_capability_memories_agent ON capability_memories (agent_id);

--------------------------------------------------------------------------------
-- pam_profiles
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pam_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL UNIQUE,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

--------------------------------------------------------------------------------
-- pvp_profiles
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pvp_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL UNIQUE,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

--------------------------------------------------------------------------------
-- watchers
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  last_fired_at_ms INTEGER,
  scheduler_owner TEXT,
  scheduler_lease_expires_at_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS watchers_active_idx ON watchers (active);
CREATE INDEX IF NOT EXISTS watchers_plan_id_idx ON watchers (plan_id);
CREATE INDEX IF NOT EXISTS watchers_workspace_id_idx ON watchers (workspace_id);
CREATE INDEX IF NOT EXISTS watchers_last_fired_at_ms_idx ON watchers (last_fired_at_ms);

--------------------------------------------------------------------------------
-- sessions
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  turns_json TEXT NOT NULL DEFAULT '[]',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  compacted_summary TEXT DEFAULT '',
  compaction_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS sessions_updated_idx ON sessions (updated_at DESC);
CREATE INDEX IF NOT EXISTS sessions_workspace_id_idx ON sessions (workspace_id);

--------------------------------------------------------------------------------
-- approvals
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  workspace_id TEXT NOT NULL DEFAULT 'default',
  run_id TEXT,
  step_id TEXT,
  attempt_id TEXT,
  resume_token TEXT,
  agent_id TEXT NOT NULL DEFAULT 'default',
  estimated_cost_micros INTEGER,
  items_preview_json TEXT,
  suggested_overrides_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT,
  response_reason TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS approvals_plan_id_idx ON approvals (plan_id);
CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals (status);
CREATE INDEX IF NOT EXISTS approvals_expires_at_idx ON approvals (expires_at);
CREATE INDEX IF NOT EXISTS approvals_workspace_id_idx ON approvals (workspace_id);
CREATE INDEX IF NOT EXISTS idx_approvals_run_id ON approvals (run_id);
CREATE INDEX IF NOT EXISTS idx_approvals_agent ON approvals (agent_id);

--------------------------------------------------------------------------------
-- jobs
--------------------------------------------------------------------------------
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

--------------------------------------------------------------------------------
-- canvas_artifacts
--------------------------------------------------------------------------------
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

--------------------------------------------------------------------------------
-- outbox
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  target_edge_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS outbox_topic_idx ON outbox (topic);
CREATE INDEX IF NOT EXISTS outbox_target_edge_idx ON outbox (target_edge_id);
CREATE INDEX IF NOT EXISTS idx_outbox_created_at ON outbox (created_at);

--------------------------------------------------------------------------------
-- outbox_consumers
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox_consumers (
  consumer_id TEXT PRIMARY KEY,
  last_outbox_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

--------------------------------------------------------------------------------
-- connection_directory
--------------------------------------------------------------------------------
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

--------------------------------------------------------------------------------
-- execution_jobs
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS execution_jobs (
  job_id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  lane TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  trigger_json TEXT NOT NULL,
  input_json TEXT,
  latest_run_id TEXT,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS execution_jobs_key_lane_idx ON execution_jobs (key, lane);
CREATE INDEX IF NOT EXISTS execution_jobs_status_idx ON execution_jobs (status);
CREATE INDEX IF NOT EXISTS execution_jobs_workspace_id_idx ON execution_jobs (workspace_id);
CREATE INDEX IF NOT EXISTS idx_execution_jobs_agent ON execution_jobs (agent_id);

--------------------------------------------------------------------------------
-- execution_runs
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS execution_runs (
  run_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  key TEXT NOT NULL,
  lane TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')),
  attempt INTEGER NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  paused_reason TEXT,
  paused_detail TEXT,
  agent_id TEXT NOT NULL DEFAULT 'default',
  budget_tokens INTEGER,
  spent_tokens INTEGER NOT NULL DEFAULT 0,
  queue_mode TEXT NOT NULL DEFAULT 'collect',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES execution_jobs(job_id)
);

CREATE INDEX IF NOT EXISTS execution_runs_job_id_idx ON execution_runs (job_id);
CREATE INDEX IF NOT EXISTS execution_runs_status_idx ON execution_runs (status);
CREATE INDEX IF NOT EXISTS idx_execution_runs_agent ON execution_runs (agent_id);
CREATE INDEX IF NOT EXISTS idx_execution_runs_finished_at ON execution_runs (finished_at);

--------------------------------------------------------------------------------
-- execution_steps
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS execution_steps (
  step_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_index INTEGER NOT NULL CHECK(step_index >= 0),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled', 'skipped')),
  action_json TEXT NOT NULL,
  idempotency_key TEXT,
  postcondition_json TEXT,
  approval_id INTEGER,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  rollback_hint TEXT,
  policy_snapshot_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES execution_runs(run_id),
  UNIQUE (run_id, step_index)
);

CREATE INDEX IF NOT EXISTS execution_steps_run_id_idx ON execution_steps (run_id);
CREATE INDEX IF NOT EXISTS execution_steps_status_idx ON execution_steps (status);

--------------------------------------------------------------------------------
-- execution_attempts
--------------------------------------------------------------------------------
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
  cost_json TEXT,
  FOREIGN KEY (step_id) REFERENCES execution_steps(step_id),
  UNIQUE (step_id, attempt)
);

CREATE INDEX IF NOT EXISTS execution_attempts_step_id_idx ON execution_attempts (step_id);
CREATE INDEX IF NOT EXISTS execution_attempts_lease_idx ON execution_attempts (status, lease_expires_at_ms);

--------------------------------------------------------------------------------
-- lane_leases
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lane_leases (
  key TEXT NOT NULL,
  lane TEXT NOT NULL,
  lease_owner TEXT NOT NULL,
  lease_expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (key, lane)
);

CREATE INDEX IF NOT EXISTS lane_leases_expires_at_idx ON lane_leases (lease_expires_at_ms);

--------------------------------------------------------------------------------
-- idempotency_records
--------------------------------------------------------------------------------
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

--------------------------------------------------------------------------------
-- resume_tokens
--------------------------------------------------------------------------------
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

--------------------------------------------------------------------------------
-- workspace_leases
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_leases (
  workspace_id TEXT NOT NULL PRIMARY KEY,
  lease_owner TEXT NOT NULL,
  lease_expires_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS workspace_leases_expires_at_idx ON workspace_leases (lease_expires_at_ms);

--------------------------------------------------------------------------------
-- presence_entries
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS presence_entries (
  client_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'client',
  node_id TEXT,
  agent_id TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  connected_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  metadata_json TEXT
);

--------------------------------------------------------------------------------
-- artifact_metadata
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifact_metadata (
  artifact_id TEXT PRIMARY KEY,
  run_id TEXT,
  step_id TEXT,
  attempt_id TEXT,
  kind TEXT NOT NULL DEFAULT 'other',
  mime_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  uri TEXT NOT NULL,
  labels_json TEXT NOT NULL DEFAULT '[]',
  agent_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_artifact_metadata_run_id ON artifact_metadata (run_id);
CREATE INDEX IF NOT EXISTS idx_artifact_metadata_step_id ON artifact_metadata (step_id);
CREATE INDEX IF NOT EXISTS idx_artifact_metadata_agent ON artifact_metadata (agent_id);
CREATE INDEX IF NOT EXISTS idx_artifact_metadata_created_at ON artifact_metadata (created_at);

--------------------------------------------------------------------------------
-- nodes
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nodes (
  node_id TEXT PRIMARY KEY,
  label TEXT,
  capabilities TEXT NOT NULL DEFAULT '[]',
  pairing_status TEXT NOT NULL DEFAULT 'pending',
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT,
  resolved_by TEXT,
  resolution_reason TEXT,
  last_seen_at TEXT,
  metadata TEXT
);

--------------------------------------------------------------------------------
-- node_capabilities
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS node_capabilities (
  node_id TEXT NOT NULL REFERENCES nodes(node_id),
  capability TEXT NOT NULL,
  PRIMARY KEY (node_id, capability)
);

--------------------------------------------------------------------------------
-- inbound_dedupe
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inbound_dedupe (
  message_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  PRIMARY KEY (message_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_inbound_dedupe_expires ON inbound_dedupe (expires_at);

--------------------------------------------------------------------------------
-- outbound_idempotency
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_idempotency (
  idempotency_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  result_json TEXT,
  PRIMARY KEY (idempotency_key, channel)
);

--------------------------------------------------------------------------------
-- policy_snapshots
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS policy_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_policy_snapshots_run_id ON policy_snapshots (run_id);

--------------------------------------------------------------------------------
-- model_auth_profiles
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_auth_profiles (
  profile_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT,
  secret_handle TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  agent_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_model_auth_profiles_provider ON model_auth_profiles (provider);
CREATE INDEX IF NOT EXISTS idx_auth_profiles_agent ON model_auth_profiles (agent_id);

--------------------------------------------------------------------------------
-- context_reports
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS context_reports (
  report_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_context_reports_run_id ON context_reports (run_id);

--------------------------------------------------------------------------------
-- policy_overrides
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS policy_overrides (
  policy_override_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  agent_id TEXT NOT NULL,
  workspace_id TEXT,
  tool_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by TEXT,
  created_from_approval_id INTEGER,
  created_from_policy_snapshot_id INTEGER,
  expires_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_policy_overrides_agent_tool ON policy_overrides (agent_id, tool_id, status);

--------------------------------------------------------------------------------
-- watcher_firings
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watcher_firings (
  firing_id TEXT PRIMARY KEY,
  watcher_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'enqueued', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (watcher_id) REFERENCES watchers(id)
);
