-- Tyrum Gateway schema v2 (SQLite) — destructive rebuild (no legacy compat).
--
-- NOTE: This migration intentionally drops all existing tables except
-- `_migrations`, then recreates the approved v2 schema.

PRAGMA foreign_keys=OFF;

-- ---------------------------------------------------------------------------
-- Drop legacy tables (keep `_migrations`)
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS facts;
DROP TABLE IF EXISTS episodic_events;
DROP TABLE IF EXISTS capability_memories;
DROP TABLE IF EXISTS pam_profiles;
DROP TABLE IF EXISTS pvp_profiles;

DROP TABLE IF EXISTS approvals;
DROP TABLE IF EXISTS auth_profiles;
DROP TABLE IF EXISTS canvas_artifacts;
DROP TABLE IF EXISTS channel_inbound_dedupe;
DROP TABLE IF EXISTS channel_inbox;
DROP TABLE IF EXISTS channel_outbox;
DROP TABLE IF EXISTS concurrency_slots;
DROP TABLE IF EXISTS connection_directory;
DROP TABLE IF EXISTS context_reports;
DROP TABLE IF EXISTS artifact_links;
DROP TABLE IF EXISTS artifact_access;
DROP TABLE IF EXISTS artifacts;
DROP TABLE IF EXISTS execution_attempts;
DROP TABLE IF EXISTS execution_steps;
DROP TABLE IF EXISTS resume_tokens;
DROP TABLE IF EXISTS turns;
DROP TABLE IF EXISTS turn_jobs;
DROP TABLE IF EXISTS execution_runs;
DROP TABLE IF EXISTS execution_jobs;
DROP TABLE IF EXISTS idempotency_records;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS lane_leases;
DROP TABLE IF EXISTS lane_queue_mode_overrides;
DROP TABLE IF EXISTS lane_queue_signals;
DROP TABLE IF EXISTS memory_item_embeddings;
DROP TABLE IF EXISTS memory_item_provenance;
DROP TABLE IF EXISTS memory_item_tags;
DROP TABLE IF EXISTS memory_items;
DROP TABLE IF EXISTS memory_tombstones;
DROP TABLE IF EXISTS models_dev_cache;
DROP TABLE IF EXISTS models_dev_refresh_leases;
DROP TABLE IF EXISTS node_pairings;
DROP TABLE IF EXISTS oauth_pending;
DROP TABLE IF EXISTS oauth_refresh_leases;
DROP TABLE IF EXISTS outbox;
DROP TABLE IF EXISTS outbox_consumers;
DROP TABLE IF EXISTS peer_identity_links;
DROP TABLE IF EXISTS planner_events;
DROP TABLE IF EXISTS policy_overrides;
DROP TABLE IF EXISTS policy_snapshots;
DROP TABLE IF EXISTS presence_entries;
DROP TABLE IF EXISTS routing_configs;
DROP TABLE IF EXISTS secret_resolutions;
DROP TABLE IF EXISTS session_model_overrides;
DROP TABLE IF EXISTS session_provider_pins;
DROP TABLE IF EXISTS session_send_policy_overrides;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS subagents;
DROP TABLE IF EXISTS vector_metadata;
DROP TABLE IF EXISTS watcher_firings;
DROP TABLE IF EXISTS watchers;
DROP TABLE IF EXISTS work_artifacts;
DROP TABLE IF EXISTS work_decisions;
DROP TABLE IF EXISTS work_item_events;
DROP TABLE IF EXISTS work_item_links;
DROP TABLE IF EXISTS work_item_state_kv;
DROP TABLE IF EXISTS work_item_tasks;
DROP TABLE IF EXISTS work_items;
DROP TABLE IF EXISTS work_scope_activity;
DROP TABLE IF EXISTS work_signal_firings;
DROP TABLE IF EXISTS work_signals;
DROP TABLE IF EXISTS workspace_leases;
DROP TABLE IF EXISTS agent_state_kv;

-- v2 tables (safe to drop if partial state exists)
DROP TABLE IF EXISTS connections;
DROP TABLE IF EXISTS principals;
DROP TABLE IF EXISTS agent_workspaces;
DROP TABLE IF EXISTS agents;
DROP TABLE IF EXISTS workspaces;
DROP TABLE IF EXISTS tenants;
DROP TABLE IF EXISTS channel_accounts;
DROP TABLE IF EXISTS channel_threads;
DROP TABLE IF EXISTS plans;
DROP TABLE IF EXISTS canvas_artifact_links;
DROP TABLE IF EXISTS secrets;
DROP TABLE IF EXISTS secret_versions;
DROP TABLE IF EXISTS auth_profile_secrets;
DROP TABLE IF EXISTS work_item_task_dependencies;

PRAGMA foreign_keys=ON;

-- ---------------------------------------------------------------------------
-- Identity + scope
-- ---------------------------------------------------------------------------

CREATE TABLE tenants (
  tenant_id  TEXT PRIMARY KEY,
  tenant_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE agents (
  tenant_id  TEXT NOT NULL,
  agent_id   TEXT NOT NULL,
  agent_key  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, agent_id),
  UNIQUE (tenant_id, agent_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE workspaces (
  tenant_id     TEXT NOT NULL,
  workspace_id  TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, workspace_id),
  UNIQUE (tenant_id, workspace_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE agent_workspaces (
  tenant_id    TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, agent_id, workspace_id),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces(tenant_id, workspace_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Channels / sessions
-- ---------------------------------------------------------------------------

CREATE TABLE channel_accounts (
  tenant_id          TEXT NOT NULL,
  workspace_id       TEXT NOT NULL,
  channel_account_id TEXT NOT NULL,
  connector_key      TEXT NOT NULL,
  account_key        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, workspace_id, channel_account_id),
  UNIQUE (tenant_id, workspace_id, connector_key, account_key),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces(tenant_id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE channel_threads (
  tenant_id          TEXT NOT NULL,
  workspace_id       TEXT NOT NULL,
  channel_thread_id  TEXT NOT NULL,
  channel_account_id TEXT NOT NULL,
  provider_thread_id TEXT NOT NULL,
  container_kind     TEXT NOT NULL CHECK (container_kind IN ('dm','group','channel')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, workspace_id, channel_thread_id),
  UNIQUE (tenant_id, workspace_id, channel_account_id, provider_thread_id),
  FOREIGN KEY (tenant_id, workspace_id, channel_account_id)
    REFERENCES channel_accounts(tenant_id, workspace_id, channel_account_id) ON DELETE CASCADE
);

CREATE TABLE sessions (
  tenant_id         TEXT NOT NULL,
  session_id        TEXT NOT NULL,
  session_key       TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  channel_thread_id TEXT NOT NULL,
  summary           TEXT NOT NULL DEFAULT '',
  turns_json        TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, session_id),
  UNIQUE (tenant_id, session_key),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, channel_thread_id)
    REFERENCES channel_threads(tenant_id, workspace_id, channel_thread_id) ON DELETE CASCADE
);

CREATE TABLE session_model_overrides (
  tenant_id   TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  model_id    TEXT NOT NULL,
  pinned_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, session_id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE CASCADE
);

CREATE TABLE session_send_policy_overrides (
  tenant_id     TEXT NOT NULL,
  key           TEXT NOT NULL,
  send_policy   TEXT NOT NULL CHECK (send_policy IN ('on','off')),
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE lane_queue_mode_overrides (
  tenant_id     TEXT NOT NULL,
  key           TEXT NOT NULL,
  lane          TEXT NOT NULL,
  queue_mode    TEXT NOT NULL CHECK (queue_mode IN ('collect','followup','steer','steer_backlog','interrupt')),
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, key, lane)
);

CREATE TABLE lane_queue_signals (
  tenant_id     TEXT NOT NULL,
  key           TEXT NOT NULL,
  lane          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('steer','interrupt')),
  inbox_id      INTEGER,
  queue_mode    TEXT NOT NULL,
  message_text  TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, key, lane)
);

-- Supporting inbound dedupe (bounded TTL; required with queue-only delete semantics).
CREATE TABLE channel_inbound_dedupe (
  tenant_id     TEXT NOT NULL,
  channel       TEXT NOT NULL,
  account_id    TEXT NOT NULL,
  container_id  TEXT NOT NULL,
  message_id    TEXT NOT NULL,
  inbox_id      INTEGER,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, channel, account_id, container_id, message_id)
);

CREATE TABLE channel_inbox (
  inbox_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id          TEXT NOT NULL,
  source             TEXT NOT NULL,
  thread_id          TEXT NOT NULL,
  message_id         TEXT NOT NULL,
  key                TEXT NOT NULL,
  lane               TEXT NOT NULL,
  received_at_ms     INTEGER NOT NULL,
  payload_json       TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
  attempt            INTEGER NOT NULL DEFAULT 0,
  lease_owner        TEXT,
  lease_expires_at_ms INTEGER,
  processed_at       TEXT,
  error              TEXT,
  reply_text         TEXT,
  queue_mode         TEXT NOT NULL DEFAULT 'collect',
  workspace_id       TEXT NOT NULL,
  session_id         TEXT NOT NULL,
  channel_thread_id  TEXT NOT NULL,
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, channel_thread_id)
    REFERENCES channel_threads(tenant_id, workspace_id, channel_thread_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS channel_inbox_tenant_inbox_uq
ON channel_inbox (tenant_id, inbox_id);

CREATE TABLE channel_outbox (
  outbox_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id          TEXT NOT NULL,
  inbox_id           INTEGER NOT NULL,
  source             TEXT NOT NULL,
  thread_id          TEXT NOT NULL,
  dedupe_key         TEXT NOT NULL,
  chunk_index        INTEGER NOT NULL DEFAULT 0,
  text               TEXT NOT NULL,
  attachments_json   TEXT NOT NULL DEFAULT '[]',
  parse_mode         TEXT,
  status             TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  attempt            INTEGER NOT NULL DEFAULT 0,
  lease_owner        TEXT,
  lease_expires_at_ms INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at            TEXT,
  error              TEXT,
  response_json      TEXT,
  approval_id        TEXT,
  workspace_id       TEXT NOT NULL,
  session_id         TEXT NOT NULL,
  channel_thread_id  TEXT NOT NULL,
  UNIQUE (tenant_id, dedupe_key),
  FOREIGN KEY (tenant_id, inbox_id) REFERENCES channel_inbox(tenant_id, inbox_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Secrets + auth (tenant-scoped, DB-backed)
-- ---------------------------------------------------------------------------

CREATE TABLE secrets (
  tenant_id        TEXT NOT NULL,
  secret_id        TEXT NOT NULL,
  secret_key       TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('active','revoked')),
  current_version  INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, secret_id),
  UNIQUE (tenant_id, secret_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE secret_versions (
  tenant_id   TEXT NOT NULL,
  secret_id   TEXT NOT NULL,
  version     INTEGER NOT NULL,
  alg         TEXT NOT NULL,
  key_id      TEXT NOT NULL,
  nonce       BLOB NOT NULL,
  ciphertext  BLOB NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at  TEXT,
  PRIMARY KEY (tenant_id, secret_id, version),
  FOREIGN KEY (tenant_id, secret_id) REFERENCES secrets(tenant_id, secret_id) ON DELETE CASCADE
);

CREATE TABLE auth_profiles (
  tenant_id         TEXT NOT NULL,
  auth_profile_id   TEXT NOT NULL,
  auth_profile_key  TEXT NOT NULL,
  provider_key      TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('api_key','oauth','token')),
  status            TEXT NOT NULL CHECK (status IN ('active','disabled')),
  labels_json       TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, auth_profile_id),
  UNIQUE (tenant_id, auth_profile_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE auth_profile_secrets (
  tenant_id        TEXT NOT NULL,
  auth_profile_id  TEXT NOT NULL,
  slot_key         TEXT NOT NULL,
  secret_id        TEXT NOT NULL,
  PRIMARY KEY (tenant_id, auth_profile_id, slot_key),
  FOREIGN KEY (tenant_id, auth_profile_id)
    REFERENCES auth_profiles(tenant_id, auth_profile_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, secret_id)
    REFERENCES secrets(tenant_id, secret_id) ON DELETE RESTRICT
);

CREATE TABLE session_provider_pins (
  tenant_id        TEXT NOT NULL,
  session_id       TEXT NOT NULL,
  provider_key     TEXT NOT NULL,
  auth_profile_id  TEXT NOT NULL,
  pinned_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, session_id, provider_key),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, auth_profile_id)
    REFERENCES auth_profiles(tenant_id, auth_profile_id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------
-- Policy + approvals
-- ---------------------------------------------------------------------------

CREATE TABLE policy_snapshots (
  tenant_id          TEXT NOT NULL,
  policy_snapshot_id TEXT NOT NULL,
  sha256             TEXT NOT NULL,
  bundle_json        TEXT NOT NULL CHECK (json_valid(bundle_json)),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, policy_snapshot_id),
  UNIQUE (tenant_id, sha256),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE policy_overrides (
  tenant_id          TEXT NOT NULL,
  policy_override_id TEXT NOT NULL,
  override_key       TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('active','revoked','expired')),
  agent_id           TEXT NOT NULL,
  workspace_id       TEXT,
  tool_id            TEXT NOT NULL,
  pattern            TEXT NOT NULL,
  created_from_approval_id TEXT,
  created_from_policy_snapshot_id TEXT,
  created_by_json    TEXT NOT NULL DEFAULT '{}',
  expires_at         TEXT,
  revoked_at         TEXT,
  revoked_by_json    TEXT,
  revoked_reason     TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, policy_override_id),
  UNIQUE (tenant_id, override_key),
  FOREIGN KEY (tenant_id, created_from_policy_snapshot_id)
    REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL
);

CREATE TABLE plans (
  tenant_id    TEXT NOT NULL,
  plan_id      TEXT NOT NULL,
  plan_key     TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id   TEXT,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, plan_id),
  UNIQUE (tenant_id, plan_key),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE SET NULL
);

CREATE TABLE planner_events (
  tenant_id   TEXT NOT NULL,
  plan_id     TEXT NOT NULL,
  step_index  INTEGER NOT NULL CHECK (step_index >= 0),
  replay_id   TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  action_json TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  prev_hash   TEXT,
  event_hash  TEXT,
  PRIMARY KEY (tenant_id, plan_id, step_index),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES plans(tenant_id, plan_id) ON DELETE CASCADE
);

CREATE TABLE approvals (
  tenant_id    TEXT NOT NULL,
  approval_id  TEXT NOT NULL,
  approval_key TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL,
  prompt       TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT,
  resolved_at  TEXT,
  resolution_json TEXT,
  session_id   TEXT,
  plan_id      TEXT,
  turn_id      TEXT,
  step_id      TEXT,
  attempt_id   TEXT,
  work_item_id TEXT,
  work_item_task_id TEXT,
  resume_token TEXT,
  PRIMARY KEY (tenant_id, approval_id),
  UNIQUE (tenant_id, approval_key),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, plan_id) REFERENCES plans(tenant_id, plan_id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Execution engine
-- ---------------------------------------------------------------------------

CREATE TABLE turn_jobs (
  tenant_id         TEXT NOT NULL,
  job_id            TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  session_id        TEXT,
  plan_id           TEXT,
  key               TEXT NOT NULL,
  lane              TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
  trigger_json      TEXT NOT NULL,
  input_json        TEXT,
  latest_run_id     TEXT,
  policy_snapshot_id TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, job_id),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, plan_id) REFERENCES plans(tenant_id, plan_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, policy_snapshot_id)
    REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL
);

CREATE TABLE turns (
  tenant_id         TEXT NOT NULL,
  turn_id           TEXT NOT NULL,
  job_id            TEXT NOT NULL,
  key               TEXT NOT NULL,
  lane              TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('queued','running','paused','succeeded','failed','cancelled')),
  attempt           INTEGER NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  started_at        TEXT,
  finished_at       TEXT,
  paused_reason     TEXT,
  paused_detail     TEXT,
  budgets_json      TEXT,
  budget_overridden_at TEXT,
  policy_snapshot_id TEXT,
  PRIMARY KEY (tenant_id, turn_id),
  FOREIGN KEY (tenant_id, job_id)
    REFERENCES turn_jobs(tenant_id, job_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, policy_snapshot_id)
    REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL
);

CREATE TABLE execution_steps (
  tenant_id         TEXT NOT NULL,
  step_id           TEXT NOT NULL,
  turn_id           TEXT NOT NULL,
  step_index        INTEGER NOT NULL CHECK (step_index >= 0),
  status            TEXT NOT NULL CHECK (status IN ('queued','running','paused','succeeded','failed','cancelled','skipped')),
  action_json       TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  idempotency_key   TEXT,
  postcondition_json TEXT,
  approval_id       TEXT,
  max_attempts      INTEGER NOT NULL DEFAULT 1,
  timeout_ms        INTEGER NOT NULL DEFAULT 60000,
  PRIMARY KEY (tenant_id, step_id),
  UNIQUE (tenant_id, turn_id, step_index),
  FOREIGN KEY (tenant_id, turn_id)
    REFERENCES turns(tenant_id, turn_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approvals(tenant_id, approval_id) ON DELETE SET NULL
);

CREATE TABLE execution_attempts (
  tenant_id           TEXT NOT NULL,
  attempt_id          TEXT NOT NULL,
  step_id             TEXT NOT NULL,
  attempt             INTEGER NOT NULL CHECK (attempt >= 1),
  status              TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','timed_out','cancelled')),
  started_at          TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at         TEXT,
  result_json         TEXT,
  error               TEXT,
  postcondition_report_json TEXT,
  artifacts_json      TEXT NOT NULL DEFAULT '[]',
  metadata_json       TEXT,
  cost_json           TEXT,
  policy_snapshot_id  TEXT,
  policy_decision_json TEXT,
  policy_applied_override_ids_json TEXT,
  lease_owner         TEXT,
  lease_expires_at_ms INTEGER,
  PRIMARY KEY (tenant_id, attempt_id),
  UNIQUE (tenant_id, step_id, attempt),
  FOREIGN KEY (tenant_id, step_id)
    REFERENCES execution_steps(tenant_id, step_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, policy_snapshot_id)
    REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL
);

CREATE TABLE artifacts (
  tenant_id            TEXT NOT NULL,
  artifact_id          TEXT NOT NULL,
  access_id            TEXT NOT NULL,
  workspace_id         TEXT NOT NULL,
  agent_id             TEXT,
  kind                 TEXT NOT NULL,
  uri                  TEXT NOT NULL,
  external_url         TEXT NOT NULL,
  media_class          TEXT,
  filename             TEXT,
  created_at           TEXT NOT NULL,
  mime_type            TEXT,
  size_bytes           INTEGER,
  sha256               TEXT,
  labels_json          TEXT NOT NULL DEFAULT '[]',
  metadata_json        TEXT NOT NULL DEFAULT '{}',
  sensitivity          TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal','sensitive')),
  policy_snapshot_id   TEXT,
  retention_expires_at TEXT,
  bytes_deleted_at     TEXT,
  bytes_deleted_reason TEXT,
  PRIMARY KEY (tenant_id, artifact_id),
  UNIQUE (access_id),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces(tenant_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, policy_snapshot_id) REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL
);

CREATE TABLE artifact_access (
  access_id   TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (tenant_id, artifact_id),
  FOREIGN KEY (tenant_id, artifact_id)
    REFERENCES artifacts(tenant_id, artifact_id) ON DELETE CASCADE
);

CREATE TABLE artifact_links (
  tenant_id    TEXT NOT NULL,
  artifact_id  TEXT NOT NULL,
  parent_kind  TEXT NOT NULL CHECK (
    parent_kind IN (
      'execution_run',
      'execution_step',
      'execution_attempt',
      'chat_session',
      'chat_message'
    )
  ),
  parent_id    TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (tenant_id, artifact_id, parent_kind, parent_id),
  FOREIGN KEY (tenant_id, artifact_id)
    REFERENCES artifacts(tenant_id, artifact_id) ON DELETE CASCADE
);

CREATE TABLE resume_tokens (
  tenant_id        TEXT NOT NULL,
  token            TEXT NOT NULL,
  turn_id          TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at       TEXT,
  revoked_at       TEXT,
  PRIMARY KEY (tenant_id, token),
  FOREIGN KEY (tenant_id, turn_id)
    REFERENCES turns(tenant_id, turn_id) ON DELETE CASCADE
);

CREATE TABLE lane_leases (
  tenant_id           TEXT NOT NULL,
  key                 TEXT NOT NULL,
  lane                TEXT NOT NULL,
  lease_owner         TEXT NOT NULL,
  lease_expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, key, lane)
);

CREATE TABLE workspace_leases (
  tenant_id           TEXT NOT NULL,
  workspace_id        TEXT NOT NULL,
  lease_owner         TEXT NOT NULL,
  lease_expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces(tenant_id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE idempotency_records (
  tenant_id        TEXT NOT NULL,
  scope_key        TEXT NOT NULL,
  kind             TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  result_json      TEXT,
  error            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, scope_key, kind, idempotency_key)
);

CREATE TABLE concurrency_slots (
  tenant_id           TEXT NOT NULL,
  scope               TEXT NOT NULL,
  scope_id            TEXT NOT NULL,
  slot                INTEGER NOT NULL,
  lease_owner         TEXT,
  lease_expires_at_ms INTEGER,
  attempt_id          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, scope, scope_id, slot)
);

-- ---------------------------------------------------------------------------
-- Watchers
-- ---------------------------------------------------------------------------

CREATE TABLE watchers (
  tenant_id      TEXT NOT NULL,
  watcher_id     TEXT NOT NULL,
  watcher_key    TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  workspace_id   TEXT NOT NULL,
  trigger_type   TEXT NOT NULL,
  trigger_config_json TEXT NOT NULL CHECK (json_valid(trigger_config_json)),
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_fired_at_ms INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, watcher_id),
  UNIQUE (tenant_id, watcher_key),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE watcher_firings (
  tenant_id          TEXT NOT NULL,
  watcher_firing_id  TEXT NOT NULL,
  watcher_id         TEXT NOT NULL,
  scheduled_at_ms    INTEGER NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('queued','processing','enqueued','failed')),
  attempt            INTEGER NOT NULL DEFAULT 0,
  lease_owner        TEXT,
  lease_expires_at_ms INTEGER,
  plan_id            TEXT,
  job_id             TEXT,
  turn_id            TEXT,
  error              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, watcher_firing_id),
  UNIQUE (tenant_id, watcher_id, scheduled_at_ms),
  FOREIGN KEY (tenant_id, watcher_id) REFERENCES watchers(tenant_id, watcher_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, plan_id) REFERENCES plans(tenant_id, plan_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, job_id)
    REFERENCES turn_jobs(tenant_id, job_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, turn_id)
    REFERENCES turns(tenant_id, turn_id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Canvas artifacts (plan NOT required)
-- ---------------------------------------------------------------------------

CREATE TABLE canvas_artifacts (
  tenant_id         TEXT NOT NULL,
  canvas_artifact_id TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  title             TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  content           TEXT NOT NULL,
  metadata_json     TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, canvas_artifact_id),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces(tenant_id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE canvas_artifact_links (
  tenant_id         TEXT NOT NULL,
  canvas_artifact_id TEXT NOT NULL,
  parent_kind       TEXT NOT NULL CHECK (parent_kind IN ('plan','session','work_item','execution_run')),
  parent_id         TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, canvas_artifact_id, parent_kind, parent_id),
  FOREIGN KEY (tenant_id, canvas_artifact_id)
    REFERENCES canvas_artifacts(tenant_id, canvas_artifact_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Context reports
-- ---------------------------------------------------------------------------

CREATE TABLE context_reports (
  tenant_id         TEXT NOT NULL,
  context_report_id TEXT NOT NULL,
  session_id        TEXT NOT NULL,
  channel           TEXT NOT NULL,
  thread_id         TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  workspace_id      TEXT NOT NULL,
  turn_id           TEXT,
  report_json       TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, context_report_id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Secret resolution audit
-- ---------------------------------------------------------------------------

CREATE TABLE secret_resolutions (
  tenant_id           TEXT NOT NULL,
  secret_resolution_id TEXT NOT NULL,
  tool_call_id        TEXT NOT NULL,
  tool_id             TEXT NOT NULL,
  handle_id           TEXT NOT NULL,
  provider            TEXT NOT NULL,
  scope               TEXT NOT NULL,
  agent_id            TEXT,
  workspace_id        TEXT,
  session_id          TEXT,
  channel             TEXT,
  thread_id           TEXT,
  policy_snapshot_id  TEXT,
  outcome             TEXT NOT NULL CHECK (outcome IN ('resolved','failed')),
  error               TEXT,
  occurred_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, secret_resolution_id),
  UNIQUE (tenant_id, tool_call_id, handle_id)
);

-- ---------------------------------------------------------------------------
-- Node/client presence + backplane outbox
-- ---------------------------------------------------------------------------

CREATE TABLE principals (
  tenant_id      TEXT NOT NULL,
  principal_id   TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('node','client')),
  principal_key  TEXT NOT NULL,
  status         TEXT NOT NULL,
  label          TEXT,
  pubkey         TEXT,
  metadata_json  TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, principal_id),
  UNIQUE (tenant_id, kind, principal_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE connections (
  tenant_id      TEXT NOT NULL,
  connection_id  TEXT NOT NULL,
  edge_id        TEXT NOT NULL,
  principal_id   TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  ready_capabilities_json TEXT,
  protocol_rev   INTEGER NOT NULL DEFAULT 1,
  connected_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL,
  expires_at_ms  INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, connection_id),
  FOREIGN KEY (tenant_id, principal_id) REFERENCES principals(tenant_id, principal_id) ON DELETE CASCADE
);

CREATE TABLE outbox (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      TEXT NOT NULL,
  topic          TEXT NOT NULL,
  target_edge_id TEXT,
  payload_json   TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE outbox_consumers (
  tenant_id      TEXT NOT NULL,
  consumer_id    TEXT NOT NULL,
  last_outbox_id INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, consumer_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE presence_entries (
  instance_id        TEXT PRIMARY KEY,
  role               TEXT NOT NULL CHECK (role IN ('gateway','client','node')),
  connection_id      TEXT,
  host               TEXT,
  ip                 TEXT,
  version            TEXT,
  mode               TEXT,
  last_input_seconds INTEGER,
  metadata_json      TEXT NOT NULL DEFAULT '{}',
  connected_at_ms    INTEGER NOT NULL,
  last_seen_at_ms    INTEGER NOT NULL,
  expires_at_ms      INTEGER NOT NULL,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Node pairing + OAuth (tenant-scoped)
-- ---------------------------------------------------------------------------

CREATE TABLE node_pairings (
  pairing_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('pending','approved','denied','revoked')),
  node_id        TEXT NOT NULL,
  pubkey         TEXT,
  label          TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  metadata_json  TEXT NOT NULL DEFAULT '{}',
  requested_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at    TEXT,
  resolved_by_json TEXT,
  resolution_reason TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  trust_level    TEXT NOT NULL DEFAULT 'remote' CHECK (trust_level IN ('local','remote')),
  capability_allowlist_json TEXT NOT NULL DEFAULT '[]',
  scoped_token_sha256 TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  UNIQUE (tenant_id, node_id)
);

CREATE TABLE oauth_pending (
  tenant_id      TEXT NOT NULL,
  state          TEXT NOT NULL,
  provider_id    TEXT NOT NULL,
  agent_key      TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  pkce_verifier  TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  scopes         TEXT NOT NULL,
  mode           TEXT NOT NULL,
  metadata_json  TEXT NOT NULL,
  PRIMARY KEY (tenant_id, state)
);

CREATE TABLE oauth_refresh_leases (
  tenant_id           TEXT NOT NULL,
  auth_profile_id     TEXT NOT NULL,
  lease_owner         TEXT NOT NULL,
  lease_expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, auth_profile_id),
  FOREIGN KEY (tenant_id, auth_profile_id) REFERENCES auth_profiles(tenant_id, auth_profile_id) ON DELETE CASCADE
);

CREATE TABLE peer_identity_links (
  tenant_id        TEXT NOT NULL,
  channel          TEXT NOT NULL,
  account          TEXT NOT NULL,
  provider_peer_id TEXT NOT NULL,
  canonical_peer_id TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, channel, account, provider_peer_id)
);

-- ---------------------------------------------------------------------------
-- Routing configs (tenant-scoped; require explicit tenant_id)
-- ---------------------------------------------------------------------------

CREATE TABLE routing_configs (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  reverted_from_revision INTEGER,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Models dev cache (global-by-design)
-- ---------------------------------------------------------------------------

CREATE TABLE models_dev_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fetched_at TEXT NULL,
  etag TEXT NULL,
  sha256 TEXT NOT NULL,
  json TEXT NOT NULL,
  source TEXT NOT NULL,
  last_error TEXT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE models_dev_refresh_leases (
  key                 TEXT PRIMARY KEY,
  lease_owner         TEXT NOT NULL,
  lease_expires_at_ms INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- WorkBoard
-- ---------------------------------------------------------------------------

CREATE TABLE work_items (
  tenant_id     TEXT NOT NULL,
  work_item_id  TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  workspace_id  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('action','initiative')),
  status        TEXT NOT NULL CHECK (status IN ('backlog','ready','doing','blocked','done','failed','cancelled')),
  priority      INTEGER NOT NULL DEFAULT 0,
  title         TEXT NOT NULL,
  acceptance_json TEXT,
  fingerprint_json TEXT,
  budgets_json  TEXT,
  parent_work_item_id TEXT,
  created_from_session_id TEXT,
  created_from_session_key TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT,
  PRIMARY KEY (tenant_id, work_item_id),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, parent_work_item_id)
    REFERENCES work_items(tenant_id, work_item_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, created_from_session_id)
    REFERENCES sessions(tenant_id, session_id) ON DELETE SET NULL
);

CREATE TABLE work_item_tasks (
  tenant_id          TEXT NOT NULL,
  task_id            TEXT NOT NULL,
  work_item_id       TEXT NOT NULL,
  status             TEXT NOT NULL,
  depends_on_json    TEXT NOT NULL DEFAULT '[]',
  execution_profile  TEXT NOT NULL,
  side_effect_class  TEXT NOT NULL,
  run_id             TEXT,
  approval_id        TEXT,
  started_at         TEXT,
  finished_at        TEXT,
  result_summary     TEXT,
  lease_owner        TEXT,
  lease_expires_at_ms INTEGER,
  artifacts_json     TEXT NOT NULL DEFAULT '[]',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, task_id),
  FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, run_id) REFERENCES turns(tenant_id, turn_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approvals(tenant_id, approval_id) ON DELETE SET NULL
);

CREATE TABLE subagents (
  tenant_id      TEXT NOT NULL,
  subagent_id    TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  workspace_id   TEXT NOT NULL,
  work_item_id   TEXT,
  work_item_task_id TEXT,
  execution_profile TEXT NOT NULL,
  session_id     TEXT,
  session_key    TEXT NOT NULL,
  lane           TEXT NOT NULL DEFAULT 'subagent',
  status         TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_heartbeat_at TEXT,
  close_reason   TEXT,
  closed_at      TEXT,
  PRIMARY KEY (tenant_id, subagent_id),
  UNIQUE (tenant_id, session_id),
  UNIQUE (tenant_id, session_key),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, work_item_task_id) REFERENCES work_item_tasks(tenant_id, task_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE SET NULL
);

CREATE TABLE work_item_events (
  tenant_id     TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  work_item_id  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  kind          TEXT NOT NULL,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, event_id),
  FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE CASCADE
);

CREATE TABLE work_item_links (
  tenant_id            TEXT NOT NULL,
  work_item_id         TEXT NOT NULL,
  linked_work_item_id  TEXT NOT NULL,
  kind                 TEXT NOT NULL,
  meta_json            TEXT NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, work_item_id, linked_work_item_id, kind),
  FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, linked_work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE CASCADE
);

CREATE TABLE work_artifacts (
  tenant_id      TEXT NOT NULL,
  artifact_id    TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  workspace_id   TEXT NOT NULL,
  work_item_id   TEXT,
  kind           TEXT NOT NULL,
  title          TEXT NOT NULL,
  body_md        TEXT,
  refs_json      TEXT NOT NULL DEFAULT '[]',
  confidence     REAL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_run_id TEXT,
  created_by_subagent_id TEXT,
  provenance_json TEXT,
  PRIMARY KEY (tenant_id, artifact_id),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, created_by_run_id) REFERENCES turns(tenant_id, turn_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, created_by_subagent_id) REFERENCES subagents(tenant_id, subagent_id) ON DELETE SET NULL
);

CREATE TABLE work_decisions (
  tenant_id        TEXT NOT NULL,
  decision_id      TEXT NOT NULL,
  agent_id         TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  work_item_id     TEXT,
  question         TEXT NOT NULL,
  chosen           TEXT NOT NULL,
  alternatives_json TEXT NOT NULL DEFAULT '[]',
  rationale_md     TEXT NOT NULL,
  input_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_run_id TEXT,
  created_by_subagent_id TEXT,
  PRIMARY KEY (tenant_id, decision_id),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, created_by_run_id) REFERENCES turns(tenant_id, turn_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, created_by_subagent_id) REFERENCES subagents(tenant_id, subagent_id) ON DELETE SET NULL
);

CREATE TABLE work_signals (
  tenant_id      TEXT NOT NULL,
  signal_id      TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  workspace_id   TEXT NOT NULL,
  work_item_id   TEXT,
  trigger_kind   TEXT NOT NULL,
  trigger_spec_json TEXT NOT NULL,
  payload_json   TEXT,
  status         TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_fired_at  TEXT,
  PRIMARY KEY (tenant_id, signal_id),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE SET NULL
);

CREATE TABLE work_signal_firings (
  tenant_id      TEXT NOT NULL,
  firing_id      TEXT NOT NULL,
  signal_id      TEXT NOT NULL,
  dedupe_key     TEXT NOT NULL,
  status         TEXT NOT NULL,
  attempt        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER,
  lease_owner    TEXT,
  lease_expires_at_ms INTEGER,
  error          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, firing_id),
  UNIQUE (tenant_id, signal_id, dedupe_key),
  FOREIGN KEY (tenant_id, signal_id) REFERENCES work_signals(tenant_id, signal_id) ON DELETE CASCADE
);

CREATE TABLE work_item_state_kv (
  tenant_id      TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  workspace_id   TEXT NOT NULL,
  work_item_id   TEXT NOT NULL,
  key            TEXT NOT NULL,
  value_json     TEXT NOT NULL,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by_run_id TEXT,
  provenance_json TEXT,
  PRIMARY KEY (tenant_id, agent_id, workspace_id, work_item_id, key),
  FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, updated_by_run_id) REFERENCES turns(tenant_id, turn_id) ON DELETE SET NULL
);

CREATE TABLE agent_state_kv (
  tenant_id      TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  workspace_id   TEXT NOT NULL,
  key            TEXT NOT NULL,
  value_json     TEXT NOT NULL,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by_run_id TEXT,
  provenance_json TEXT,
  PRIMARY KEY (tenant_id, agent_id, workspace_id, key),
  FOREIGN KEY (tenant_id, updated_by_run_id) REFERENCES turns(tenant_id, turn_id) ON DELETE SET NULL
);

CREATE TABLE work_scope_activity (
  tenant_id      TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  workspace_id   TEXT NOT NULL,
  last_active_session_key TEXT NOT NULL,
  updated_at_ms  INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, agent_id, workspace_id)
);

-- ---------------------------------------------------------------------------
-- Memory (v1, tenant-safe)
-- ---------------------------------------------------------------------------

CREATE TABLE memory_items (
  tenant_id      TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  memory_item_id TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('fact','note','procedure','episode')),
  sensitivity    TEXT NOT NULL DEFAULT 'private' CHECK (sensitivity IN ('public','private','sensitive')),
  confidence     REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  key            TEXT,
  value_json     TEXT,
  observed_at    TEXT,
  title          TEXT,
  body_md        TEXT,
  occurred_at    TEXT,
  summary_md     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT,
  PRIMARY KEY (tenant_id, agent_id, memory_item_id),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

CREATE TABLE memory_item_provenance (
  tenant_id      TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  memory_item_id TEXT NOT NULL,
  source_kind    TEXT NOT NULL,
  channel        TEXT,
  thread_id      TEXT,
  session_id     TEXT,
  message_id     TEXT,
  tool_call_id   TEXT,
  refs_json      TEXT NOT NULL DEFAULT '[]',
  metadata_json  TEXT,
  PRIMARY KEY (tenant_id, agent_id, memory_item_id),
  FOREIGN KEY (tenant_id, agent_id, memory_item_id)
    REFERENCES memory_items(tenant_id, agent_id, memory_item_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

CREATE TABLE memory_item_tags (
  tenant_id      TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  memory_item_id TEXT NOT NULL,
  tag            TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, agent_id, memory_item_id, tag),
  FOREIGN KEY (tenant_id, agent_id, memory_item_id)
    REFERENCES memory_items(tenant_id, agent_id, memory_item_id) ON DELETE CASCADE
);

CREATE TABLE memory_tombstones (
  tenant_id      TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  memory_item_id TEXT NOT NULL,
  deleted_at     TEXT NOT NULL,
  deleted_by     TEXT NOT NULL,
  reason         TEXT,
  PRIMARY KEY (tenant_id, agent_id, memory_item_id)
);

CREATE TABLE memory_item_embeddings (
  tenant_id      TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  memory_item_id TEXT NOT NULL,
  embedding_id   TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  vector_data    TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, agent_id, memory_item_id, embedding_id),
  FOREIGN KEY (tenant_id, agent_id, memory_item_id)
    REFERENCES memory_items(tenant_id, agent_id, memory_item_id) ON DELETE CASCADE
);

CREATE TABLE vector_metadata (
  vector_metadata_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  embedding_id   TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  label          TEXT,
  metadata_json  TEXT,
  vector_data    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, embedding_id),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Seed default tenant/agent/workspace
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO tenants (tenant_id, tenant_key)
VALUES ('00000000-0000-4000-8000-000000000001', 'default');

INSERT OR IGNORE INTO agents (tenant_id, agent_id, agent_key)
VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'default');

INSERT OR IGNORE INTO workspaces (tenant_id, workspace_id, workspace_key)
VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003', 'default');

INSERT OR IGNORE INTO agent_workspaces (tenant_id, agent_id, workspace_id)
VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003');
