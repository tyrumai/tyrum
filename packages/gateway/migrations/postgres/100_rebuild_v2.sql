-- Tyrum Gateway schema v2 (Postgres) — destructive rebuild (no legacy compat).
--
-- NOTE: This migration intentionally drops all existing tables except
-- `_migrations`, then recreates the approved v2 schema.

-- ---------------------------------------------------------------------------
-- Drop legacy tables (keep `_migrations`)
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS facts CASCADE;
DROP TABLE IF EXISTS episodic_events CASCADE;
DROP TABLE IF EXISTS capability_memories CASCADE;
DROP TABLE IF EXISTS pam_profiles CASCADE;
DROP TABLE IF EXISTS pvp_profiles CASCADE;

DROP TABLE IF EXISTS approvals CASCADE;
DROP TABLE IF EXISTS auth_profiles CASCADE;
DROP TABLE IF EXISTS canvas_artifacts CASCADE;
DROP TABLE IF EXISTS channel_inbound_dedupe CASCADE;
DROP TABLE IF EXISTS channel_inbox CASCADE;
DROP TABLE IF EXISTS channel_outbox CASCADE;
DROP TABLE IF EXISTS concurrency_slots CASCADE;
DROP TABLE IF EXISTS connection_directory CASCADE;
DROP TABLE IF EXISTS context_reports CASCADE;
DROP TABLE IF EXISTS execution_artifacts CASCADE;
DROP TABLE IF EXISTS execution_attempts CASCADE;
DROP TABLE IF EXISTS execution_jobs CASCADE;
DROP TABLE IF EXISTS execution_runs CASCADE;
DROP TABLE IF EXISTS execution_steps CASCADE;
DROP TABLE IF EXISTS idempotency_records CASCADE;
DROP TABLE IF EXISTS intake_mode_overrides CASCADE;
DROP TABLE IF EXISTS jobs CASCADE;
DROP TABLE IF EXISTS lane_leases CASCADE;
DROP TABLE IF EXISTS lane_queue_mode_overrides CASCADE;
DROP TABLE IF EXISTS lane_queue_signals CASCADE;
DROP TABLE IF EXISTS memory_item_embeddings CASCADE;
DROP TABLE IF EXISTS memory_item_provenance CASCADE;
DROP TABLE IF EXISTS memory_item_tags CASCADE;
DROP TABLE IF EXISTS memory_items CASCADE;
DROP TABLE IF EXISTS memory_tombstones CASCADE;
DROP TABLE IF EXISTS models_dev_cache CASCADE;
DROP TABLE IF EXISTS models_dev_refresh_leases CASCADE;
DROP TABLE IF EXISTS node_pairings CASCADE;
DROP TABLE IF EXISTS oauth_pending CASCADE;
DROP TABLE IF EXISTS oauth_refresh_leases CASCADE;
DROP TABLE IF EXISTS outbox CASCADE;
DROP TABLE IF EXISTS outbox_consumers CASCADE;
DROP TABLE IF EXISTS peer_identity_links CASCADE;
DROP TABLE IF EXISTS planner_events CASCADE;
DROP TABLE IF EXISTS policy_overrides CASCADE;
DROP TABLE IF EXISTS policy_snapshots CASCADE;
DROP TABLE IF EXISTS presence_entries CASCADE;
DROP TABLE IF EXISTS resume_tokens CASCADE;
DROP TABLE IF EXISTS routing_configs CASCADE;
DROP TABLE IF EXISTS secret_resolutions CASCADE;
DROP TABLE IF EXISTS session_model_overrides CASCADE;
DROP TABLE IF EXISTS session_provider_pins CASCADE;
DROP TABLE IF EXISTS session_send_policy_overrides CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS subagents CASCADE;
DROP TABLE IF EXISTS vector_metadata CASCADE;
DROP TABLE IF EXISTS watcher_firings CASCADE;
DROP TABLE IF EXISTS watchers CASCADE;
DROP TABLE IF EXISTS work_artifacts CASCADE;
DROP TABLE IF EXISTS work_decisions CASCADE;
DROP TABLE IF EXISTS work_item_events CASCADE;
DROP TABLE IF EXISTS work_item_links CASCADE;
DROP TABLE IF EXISTS work_item_state_kv CASCADE;
DROP TABLE IF EXISTS work_item_tasks CASCADE;
DROP TABLE IF EXISTS work_items CASCADE;
DROP TABLE IF EXISTS work_scope_activity CASCADE;
DROP TABLE IF EXISTS work_signal_firings CASCADE;
DROP TABLE IF EXISTS work_signals CASCADE;
DROP TABLE IF EXISTS workspace_leases CASCADE;
DROP TABLE IF EXISTS agent_state_kv CASCADE;

-- v2 tables (safe to drop if partial state exists)
DROP TABLE IF EXISTS connections CASCADE;
DROP TABLE IF EXISTS principals CASCADE;
DROP TABLE IF EXISTS agent_workspaces CASCADE;
DROP TABLE IF EXISTS agents CASCADE;
DROP TABLE IF EXISTS workspaces CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;
DROP TABLE IF EXISTS channel_accounts CASCADE;
DROP TABLE IF EXISTS channel_threads CASCADE;
DROP TABLE IF EXISTS plans CASCADE;
DROP TABLE IF EXISTS canvas_artifact_links CASCADE;
DROP TABLE IF EXISTS secrets CASCADE;
DROP TABLE IF EXISTS secret_versions CASCADE;
DROP TABLE IF EXISTS auth_profile_secrets CASCADE;
DROP TABLE IF EXISTS work_item_task_dependencies CASCADE;

-- ---------------------------------------------------------------------------
-- Identity + scope
-- ---------------------------------------------------------------------------

CREATE TABLE tenants (
  tenant_id  UUID PRIMARY KEY,
  tenant_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agents (
  tenant_id  UUID NOT NULL,
  agent_id   UUID NOT NULL,
  agent_key  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, agent_id),
  UNIQUE (tenant_id, agent_key),
  CONSTRAINT agents_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE workspaces (
  tenant_id     UUID NOT NULL,
  workspace_id  UUID NOT NULL,
  workspace_key TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_id),
  UNIQUE (tenant_id, workspace_key),
  CONSTRAINT workspaces_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE agent_workspaces (
  tenant_id    UUID NOT NULL,
  agent_id     UUID NOT NULL,
  workspace_id UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, agent_id, workspace_id),
  CONSTRAINT agent_workspaces_agent_fk
    FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE,
  CONSTRAINT agent_workspaces_workspace_fk
    FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces(tenant_id, workspace_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Channels / sessions
-- ---------------------------------------------------------------------------

CREATE TABLE channel_accounts (
  tenant_id          UUID NOT NULL,
  workspace_id       UUID NOT NULL,
  channel_account_id UUID NOT NULL,
  connector_key      TEXT NOT NULL,
  account_key        TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_id, channel_account_id),
  UNIQUE (tenant_id, workspace_id, connector_key, account_key),
  CONSTRAINT channel_accounts_workspace_fk
    FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces(tenant_id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE channel_threads (
  tenant_id          UUID NOT NULL,
  workspace_id       UUID NOT NULL,
  channel_thread_id  UUID NOT NULL,
  channel_account_id UUID NOT NULL,
  provider_thread_id TEXT NOT NULL,
  container_kind     TEXT NOT NULL CHECK (container_kind IN ('dm','group','channel')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workspace_id, channel_thread_id),
  UNIQUE (tenant_id, workspace_id, channel_account_id, provider_thread_id),
  CONSTRAINT channel_threads_account_fk
    FOREIGN KEY (tenant_id, workspace_id, channel_account_id)
    REFERENCES channel_accounts(tenant_id, workspace_id, channel_account_id) ON DELETE CASCADE
);

CREATE TABLE sessions (
  tenant_id         UUID NOT NULL,
  session_id        UUID NOT NULL,
  session_key       TEXT NOT NULL,
  agent_id          UUID NOT NULL,
  workspace_id      UUID NOT NULL,
  channel_thread_id UUID NOT NULL,
  summary           TEXT NOT NULL DEFAULT '',
  turns_json        TEXT NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, session_id),
  UNIQUE (tenant_id, session_key),
  CONSTRAINT sessions_membership_fk
    FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT sessions_channel_thread_fk
    FOREIGN KEY (tenant_id, workspace_id, channel_thread_id)
    REFERENCES channel_threads(tenant_id, workspace_id, channel_thread_id) ON DELETE CASCADE
);

CREATE TABLE session_model_overrides (
  tenant_id  UUID NOT NULL,
  session_id UUID NOT NULL,
  model_id   TEXT NOT NULL,
  pinned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, session_id),
  CONSTRAINT session_model_overrides_session_fk
    FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE CASCADE
);

CREATE TABLE session_send_policy_overrides (
  tenant_id     UUID NOT NULL,
  key           TEXT NOT NULL,
  send_policy   TEXT NOT NULL CHECK (send_policy IN ('on','off')),
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE intake_mode_overrides (
  tenant_id     UUID NOT NULL,
  key           TEXT NOT NULL,
  lane          TEXT NOT NULL,
  intake_mode   TEXT NOT NULL CHECK (intake_mode IN ('inline','delegate_execute','delegate_plan')),
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, key, lane)
);

CREATE TABLE lane_queue_mode_overrides (
  tenant_id     UUID NOT NULL,
  key           TEXT NOT NULL,
  lane          TEXT NOT NULL,
  queue_mode    TEXT NOT NULL CHECK (queue_mode IN ('collect','followup','steer','steer_backlog','interrupt')),
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, key, lane)
);

CREATE TABLE lane_queue_signals (
  tenant_id     UUID NOT NULL,
  key           TEXT NOT NULL,
  lane          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('steer','interrupt')),
  inbox_id      BIGINT,
  queue_mode    TEXT NOT NULL,
  message_text  TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, key, lane)
);

-- Supporting inbound dedupe (bounded TTL; required with queue-only delete semantics).
CREATE TABLE channel_inbound_dedupe (
  tenant_id     UUID NOT NULL,
  channel       TEXT NOT NULL,
  account_id    TEXT NOT NULL,
  container_id  TEXT NOT NULL,
  message_id    TEXT NOT NULL,
  inbox_id      BIGINT,
  expires_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, channel, account_id, container_id, message_id)
);

CREATE TABLE channel_inbox (
  inbox_id            BIGSERIAL PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  source              TEXT NOT NULL,
  thread_id           TEXT NOT NULL,
  message_id          TEXT NOT NULL,
  key                 TEXT NOT NULL,
  lane                TEXT NOT NULL,
  received_at_ms      BIGINT NOT NULL,
  payload_json        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
  attempt             INTEGER NOT NULL DEFAULT 0,
  lease_owner         TEXT,
  lease_expires_at_ms BIGINT,
  processed_at        TIMESTAMPTZ,
  error               TEXT,
  reply_text          TEXT,
  queue_mode          TEXT NOT NULL DEFAULT 'collect',
  workspace_id        UUID NOT NULL,
  session_id          UUID NOT NULL,
  channel_thread_id   UUID NOT NULL,
  CONSTRAINT channel_inbox_session_fk
    FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE CASCADE,
  CONSTRAINT channel_inbox_channel_thread_fk
    FOREIGN KEY (tenant_id, workspace_id, channel_thread_id)
    REFERENCES channel_threads(tenant_id, workspace_id, channel_thread_id) ON DELETE CASCADE,
  CONSTRAINT channel_inbox_tenant_inbox_uq UNIQUE (tenant_id, inbox_id)
);

CREATE TABLE channel_outbox (
  outbox_id           BIGSERIAL PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  inbox_id            BIGINT NOT NULL,
  source              TEXT NOT NULL,
  thread_id           TEXT NOT NULL,
  dedupe_key          TEXT NOT NULL,
  chunk_index         INTEGER NOT NULL DEFAULT 0,
  text                TEXT NOT NULL,
  parse_mode          TEXT,
  status              TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  attempt             INTEGER NOT NULL DEFAULT 0,
  lease_owner         TEXT,
  lease_expires_at_ms BIGINT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ,
  error               TEXT,
  response_json       TEXT,
  approval_id         UUID,
  workspace_id        UUID NOT NULL,
  session_id          UUID NOT NULL,
  channel_thread_id   UUID NOT NULL,
  CONSTRAINT channel_outbox_dedupe_uq UNIQUE (tenant_id, dedupe_key),
  CONSTRAINT channel_outbox_inbox_fk
    FOREIGN KEY (tenant_id, inbox_id) REFERENCES channel_inbox(tenant_id, inbox_id) ON DELETE CASCADE,
  CONSTRAINT channel_outbox_session_fk
    FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Secrets + auth (tenant-scoped, DB-backed)
-- ---------------------------------------------------------------------------

CREATE TABLE secrets (
  tenant_id       UUID NOT NULL,
  secret_id       UUID NOT NULL,
  secret_key      TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('active','revoked')),
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, secret_id),
  UNIQUE (tenant_id, secret_key),
  CONSTRAINT secrets_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE secret_versions (
  tenant_id  UUID NOT NULL,
  secret_id  UUID NOT NULL,
  version    INTEGER NOT NULL,
  alg        TEXT NOT NULL,
  key_id     TEXT NOT NULL,
  nonce      BYTEA NOT NULL,
  ciphertext BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, secret_id, version),
  CONSTRAINT secret_versions_secret_fk
    FOREIGN KEY (tenant_id, secret_id) REFERENCES secrets(tenant_id, secret_id) ON DELETE CASCADE
);

CREATE TABLE auth_profiles (
  tenant_id        UUID NOT NULL,
  auth_profile_id  UUID NOT NULL,
  auth_profile_key TEXT NOT NULL,
  provider_key     TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('api_key','oauth','token')),
  status           TEXT NOT NULL CHECK (status IN ('active','disabled')),
  labels_json      TEXT NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, auth_profile_id),
  UNIQUE (tenant_id, auth_profile_key),
  CONSTRAINT auth_profiles_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE auth_profile_secrets (
  tenant_id       UUID NOT NULL,
  auth_profile_id UUID NOT NULL,
  slot_key        TEXT NOT NULL,
  secret_id       UUID NOT NULL,
  PRIMARY KEY (tenant_id, auth_profile_id, slot_key),
  CONSTRAINT auth_profile_secrets_profile_fk
    FOREIGN KEY (tenant_id, auth_profile_id)
    REFERENCES auth_profiles(tenant_id, auth_profile_id) ON DELETE CASCADE,
  CONSTRAINT auth_profile_secrets_secret_fk
    FOREIGN KEY (tenant_id, secret_id)
    REFERENCES secrets(tenant_id, secret_id) ON DELETE RESTRICT
);

CREATE TABLE session_provider_pins (
  tenant_id       UUID NOT NULL,
  session_id      UUID NOT NULL,
  provider_key    TEXT NOT NULL,
  auth_profile_id UUID NOT NULL,
  pinned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, session_id, provider_key),
  CONSTRAINT session_provider_pins_session_fk
    FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE CASCADE,
  CONSTRAINT session_provider_pins_profile_fk
    FOREIGN KEY (tenant_id, auth_profile_id)
    REFERENCES auth_profiles(tenant_id, auth_profile_id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------
-- Policy + approvals
-- ---------------------------------------------------------------------------

CREATE TABLE policy_snapshots (
  tenant_id          UUID NOT NULL,
  policy_snapshot_id UUID NOT NULL,
  sha256             TEXT NOT NULL,
  bundle_json        TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, policy_snapshot_id),
  UNIQUE (tenant_id, sha256),
  CONSTRAINT policy_snapshots_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE policy_overrides (
  tenant_id                    UUID NOT NULL,
  policy_override_id           UUID NOT NULL,
  override_key                 TEXT NOT NULL,
  status                       TEXT NOT NULL CHECK (status IN ('active','revoked','expired')),
  agent_id                     UUID NOT NULL,
  workspace_id                 UUID,
  tool_id                      TEXT NOT NULL,
  pattern                      TEXT NOT NULL,
  created_from_approval_id     UUID,
  created_from_policy_snapshot_id UUID,
  created_by_json              TEXT NOT NULL DEFAULT '{}',
  expires_at                   TIMESTAMPTZ,
  revoked_at                   TIMESTAMPTZ,
  revoked_by_json              TEXT,
  revoked_reason               TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, policy_override_id),
  UNIQUE (tenant_id, override_key),
  CONSTRAINT policy_overrides_snapshot_fk
    FOREIGN KEY (tenant_id, created_from_policy_snapshot_id)
    REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL
);

CREATE TABLE plans (
  tenant_id    UUID NOT NULL,
  plan_id      UUID NOT NULL,
  plan_key     TEXT NOT NULL,
  agent_id     UUID NOT NULL,
  workspace_id UUID NOT NULL,
  session_id   UUID,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, plan_id),
  UNIQUE (tenant_id, plan_key),
  CONSTRAINT plans_membership_fk
    FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT plans_session_fk
    FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE SET NULL
);

CREATE TABLE planner_events (
  tenant_id   UUID NOT NULL,
  plan_id     UUID NOT NULL,
  step_index  INTEGER NOT NULL CHECK (step_index >= 0),
  replay_id   TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  action_json TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  prev_hash   TEXT,
  event_hash  TEXT,
  PRIMARY KEY (tenant_id, plan_id, step_index),
  CONSTRAINT planner_events_plan_fk
    FOREIGN KEY (tenant_id, plan_id) REFERENCES plans(tenant_id, plan_id) ON DELETE CASCADE
);

CREATE TABLE approvals (
  tenant_id    UUID NOT NULL,
  approval_id  UUID NOT NULL,
  approval_key TEXT NOT NULL,
  agent_id     UUID NOT NULL,
  workspace_id UUID NOT NULL,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL,
  prompt       TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ,
  resolved_at  TIMESTAMPTZ,
  resolution_json TEXT,
  session_id   UUID,
  plan_id      UUID,
  run_id       UUID,
  step_id      UUID,
  attempt_id   UUID,
  work_item_id UUID,
  work_item_task_id UUID,
  resume_token TEXT,
  PRIMARY KEY (tenant_id, approval_id),
  UNIQUE (tenant_id, approval_key),
  CONSTRAINT approvals_membership_fk
    FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT approvals_session_fk
    FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE SET NULL,
  CONSTRAINT approvals_plan_fk
    FOREIGN KEY (tenant_id, plan_id) REFERENCES plans(tenant_id, plan_id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Execution engine
-- ---------------------------------------------------------------------------

CREATE TABLE execution_jobs (
  tenant_id        UUID NOT NULL,
  job_id           UUID NOT NULL,
  agent_id         UUID NOT NULL,
  workspace_id     UUID NOT NULL,
  session_id       UUID,
  plan_id          UUID,
  key              TEXT NOT NULL,
  lane             TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
  trigger_json     TEXT NOT NULL,
  input_json       TEXT,
  latest_run_id    UUID,
  policy_snapshot_id UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, job_id),
  CONSTRAINT execution_jobs_membership_fk
    FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT execution_jobs_session_fk
    FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE SET NULL,
  CONSTRAINT execution_jobs_plan_fk
    FOREIGN KEY (tenant_id, plan_id) REFERENCES plans(tenant_id, plan_id) ON DELETE SET NULL,
  CONSTRAINT execution_jobs_policy_snapshot_fk
    FOREIGN KEY (tenant_id, policy_snapshot_id)
    REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL
);

CREATE TABLE execution_runs (
  tenant_id        UUID NOT NULL,
  run_id           UUID NOT NULL,
  job_id           UUID NOT NULL,
  key              TEXT NOT NULL,
  lane             TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('queued','running','paused','succeeded','failed','cancelled')),
  attempt          INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  paused_reason    TEXT,
  paused_detail    TEXT,
  budgets_json     TEXT,
  budget_overridden_at TIMESTAMPTZ,
  policy_snapshot_id UUID,
  PRIMARY KEY (tenant_id, run_id),
  CONSTRAINT execution_runs_job_fk
    FOREIGN KEY (tenant_id, job_id) REFERENCES execution_jobs(tenant_id, job_id) ON DELETE CASCADE,
  CONSTRAINT execution_runs_policy_snapshot_fk
    FOREIGN KEY (tenant_id, policy_snapshot_id)
    REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL
);

CREATE TABLE execution_steps (
  tenant_id        UUID NOT NULL,
  step_id          UUID NOT NULL,
  run_id           UUID NOT NULL,
  step_index       INTEGER NOT NULL CHECK (step_index >= 0),
  status           TEXT NOT NULL CHECK (status IN ('queued','running','paused','succeeded','failed','cancelled','skipped')),
  action_json      TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key  TEXT,
  postcondition_json TEXT,
  approval_id      UUID,
  max_attempts     INTEGER NOT NULL DEFAULT 3,
  timeout_ms       INTEGER NOT NULL DEFAULT 60000,
  PRIMARY KEY (tenant_id, step_id),
  UNIQUE (tenant_id, run_id, step_index),
  CONSTRAINT execution_steps_run_fk
    FOREIGN KEY (tenant_id, run_id) REFERENCES execution_runs(tenant_id, run_id) ON DELETE CASCADE,
  CONSTRAINT execution_steps_approval_fk
    FOREIGN KEY (tenant_id, approval_id) REFERENCES approvals(tenant_id, approval_id) ON DELETE SET NULL
);

CREATE TABLE execution_attempts (
  tenant_id        UUID NOT NULL,
  attempt_id       UUID NOT NULL,
  step_id          UUID NOT NULL,
  attempt          INTEGER NOT NULL CHECK (attempt >= 1),
  status           TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','timed_out','cancelled')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  result_json      TEXT,
  error            TEXT,
  postcondition_report_json TEXT,
  artifacts_json   TEXT NOT NULL DEFAULT '[]',
  metadata_json    TEXT,
  cost_json        TEXT,
  policy_snapshot_id UUID,
  policy_decision_json TEXT,
  policy_applied_override_ids_json TEXT,
  lease_owner      TEXT,
  lease_expires_at_ms BIGINT,
  PRIMARY KEY (tenant_id, attempt_id),
  UNIQUE (tenant_id, step_id, attempt),
  CONSTRAINT execution_attempts_step_fk
    FOREIGN KEY (tenant_id, step_id) REFERENCES execution_steps(tenant_id, step_id) ON DELETE CASCADE,
  CONSTRAINT execution_attempts_policy_snapshot_fk
    FOREIGN KEY (tenant_id, policy_snapshot_id)
    REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL
);

CREATE TABLE execution_artifacts (
  tenant_id    UUID NOT NULL,
  artifact_id  UUID NOT NULL,
  workspace_id UUID NOT NULL,
  agent_id     UUID,
  run_id       UUID,
  step_id      UUID,
  attempt_id   UUID,
  kind         TEXT NOT NULL,
  uri          TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL,
  mime_type    TEXT,
  size_bytes   BIGINT,
  sha256       TEXT,
  labels_json  TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  sensitivity  TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal','sensitive')),
  policy_snapshot_id UUID,
  retention_expires_at TIMESTAMPTZ,
  bytes_deleted_at TIMESTAMPTZ,
  bytes_deleted_reason TEXT,
  PRIMARY KEY (tenant_id, artifact_id),
  CONSTRAINT execution_artifacts_workspace_fk
    FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces(tenant_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT execution_artifacts_agent_fk
    FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE SET NULL,
  CONSTRAINT execution_artifacts_run_fk
    FOREIGN KEY (tenant_id, run_id) REFERENCES execution_runs(tenant_id, run_id) ON DELETE SET NULL,
  CONSTRAINT execution_artifacts_step_fk
    FOREIGN KEY (tenant_id, step_id) REFERENCES execution_steps(tenant_id, step_id) ON DELETE SET NULL,
  CONSTRAINT execution_artifacts_attempt_fk
    FOREIGN KEY (tenant_id, attempt_id) REFERENCES execution_attempts(tenant_id, attempt_id) ON DELETE SET NULL,
  CONSTRAINT execution_artifacts_policy_snapshot_fk
    FOREIGN KEY (tenant_id, policy_snapshot_id)
    REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL
);

CREATE TABLE resume_tokens (
  tenant_id UUID NOT NULL,
  token     TEXT NOT NULL,
  run_id    UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, token),
  CONSTRAINT resume_tokens_run_fk
    FOREIGN KEY (tenant_id, run_id) REFERENCES execution_runs(tenant_id, run_id) ON DELETE CASCADE
);

CREATE TABLE lane_leases (
  tenant_id           UUID NOT NULL,
  key                 TEXT NOT NULL,
  lane                TEXT NOT NULL,
  lease_owner         TEXT NOT NULL,
  lease_expires_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, key, lane)
);

CREATE TABLE workspace_leases (
  tenant_id           UUID NOT NULL,
  workspace_id        UUID NOT NULL,
  lease_owner         TEXT NOT NULL,
  lease_expires_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, workspace_id),
  CONSTRAINT workspace_leases_workspace_fk
    FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces(tenant_id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE idempotency_records (
  tenant_id       UUID NOT NULL,
  scope_key       TEXT NOT NULL,
  kind            TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  result_json     TEXT,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope_key, kind, idempotency_key)
);

CREATE TABLE concurrency_slots (
  tenant_id           UUID NOT NULL,
  scope               TEXT NOT NULL,
  scope_id            TEXT NOT NULL,
  slot                INTEGER NOT NULL,
  lease_owner         TEXT,
  lease_expires_at_ms BIGINT,
  attempt_id          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope, scope_id, slot)
);

-- ---------------------------------------------------------------------------
-- Watchers
-- ---------------------------------------------------------------------------

CREATE TABLE watchers (
  tenant_id    UUID NOT NULL,
  watcher_id   UUID NOT NULL,
  watcher_key  TEXT NOT NULL,
  agent_id     UUID NOT NULL,
  workspace_id UUID NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_config_json TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT true,
  last_fired_at_ms BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, watcher_id),
  UNIQUE (tenant_id, watcher_key),
  CONSTRAINT watchers_membership_fk
    FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE watcher_firings (
  tenant_id          UUID NOT NULL,
  watcher_firing_id  UUID NOT NULL,
  watcher_id         UUID NOT NULL,
  scheduled_at_ms    BIGINT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('queued','processing','enqueued','failed')),
  attempt            INTEGER NOT NULL DEFAULT 0,
  lease_owner        TEXT,
  lease_expires_at_ms BIGINT,
  plan_id            UUID,
  job_id             UUID,
  run_id             UUID,
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, watcher_firing_id),
  UNIQUE (tenant_id, watcher_id, scheduled_at_ms),
  CONSTRAINT watcher_firings_watcher_fk
    FOREIGN KEY (tenant_id, watcher_id) REFERENCES watchers(tenant_id, watcher_id) ON DELETE CASCADE,
  CONSTRAINT watcher_firings_plan_fk
    FOREIGN KEY (tenant_id, plan_id) REFERENCES plans(tenant_id, plan_id) ON DELETE SET NULL,
  CONSTRAINT watcher_firings_job_fk
    FOREIGN KEY (tenant_id, job_id) REFERENCES execution_jobs(tenant_id, job_id) ON DELETE SET NULL,
  CONSTRAINT watcher_firings_run_fk
    FOREIGN KEY (tenant_id, run_id) REFERENCES execution_runs(tenant_id, run_id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Canvas artifacts (plan NOT required)
-- ---------------------------------------------------------------------------

CREATE TABLE canvas_artifacts (
  tenant_id         UUID NOT NULL,
  canvas_artifact_id UUID NOT NULL,
  workspace_id      UUID NOT NULL,
  title             TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  content           TEXT NOT NULL,
  metadata_json     TEXT NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, canvas_artifact_id),
  CONSTRAINT canvas_artifacts_workspace_fk
    FOREIGN KEY (tenant_id, workspace_id) REFERENCES workspaces(tenant_id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE canvas_artifact_links (
  tenant_id         UUID NOT NULL,
  canvas_artifact_id UUID NOT NULL,
  parent_kind       TEXT NOT NULL CHECK (parent_kind IN ('plan','session','work_item','execution_run')),
  parent_id         UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, canvas_artifact_id, parent_kind, parent_id),
  CONSTRAINT canvas_artifact_links_artifact_fk
    FOREIGN KEY (tenant_id, canvas_artifact_id)
    REFERENCES canvas_artifacts(tenant_id, canvas_artifact_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Context reports
-- ---------------------------------------------------------------------------

CREATE TABLE context_reports (
  tenant_id         UUID NOT NULL,
  context_report_id UUID NOT NULL,
  session_id        UUID NOT NULL,
  channel           TEXT NOT NULL,
  thread_id         TEXT NOT NULL,
  agent_id          UUID NOT NULL,
  workspace_id      UUID NOT NULL,
  run_id            UUID,
  report_json       TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, context_report_id),
  CONSTRAINT context_reports_session_fk
    FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Secret resolution audit
-- ---------------------------------------------------------------------------

CREATE TABLE secret_resolutions (
  tenant_id            UUID NOT NULL,
  secret_resolution_id UUID NOT NULL,
  tool_call_id         TEXT NOT NULL,
  tool_id              TEXT NOT NULL,
  handle_id            TEXT NOT NULL,
  provider             TEXT NOT NULL,
  scope                TEXT NOT NULL,
  agent_id             UUID,
  workspace_id         UUID,
  session_id           UUID,
  channel              TEXT,
  thread_id            TEXT,
  policy_snapshot_id   UUID,
  outcome              TEXT NOT NULL CHECK (outcome IN ('resolved','failed')),
  error                TEXT,
  occurred_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, secret_resolution_id),
  UNIQUE (tenant_id, tool_call_id, handle_id)
);

-- ---------------------------------------------------------------------------
-- Node/client presence + backplane outbox
-- ---------------------------------------------------------------------------

CREATE TABLE principals (
  tenant_id     UUID NOT NULL,
  principal_id  UUID NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('node','client')),
  principal_key TEXT NOT NULL,
  status        TEXT NOT NULL,
  label         TEXT,
  pubkey        TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, principal_id),
  UNIQUE (tenant_id, kind, principal_key),
  CONSTRAINT principals_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE connections (
  tenant_id      UUID NOT NULL,
  connection_id  UUID NOT NULL,
  edge_id        TEXT NOT NULL,
  principal_id   UUID NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  ready_capabilities_json TEXT,
  protocol_rev   INTEGER NOT NULL DEFAULT 1,
  connected_at_ms BIGINT NOT NULL,
  last_seen_at_ms BIGINT NOT NULL,
  expires_at_ms  BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, connection_id),
  CONSTRAINT connections_principal_fk
    FOREIGN KEY (tenant_id, principal_id) REFERENCES principals(tenant_id, principal_id) ON DELETE CASCADE
);

CREATE TABLE outbox (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  topic         TEXT NOT NULL,
  target_edge_id TEXT,
  payload_json  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT outbox_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE outbox_consumers (
  tenant_id      UUID NOT NULL,
  consumer_id    TEXT NOT NULL,
  last_outbox_id BIGINT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, consumer_id),
  CONSTRAINT outbox_consumers_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
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
  connected_at_ms    BIGINT NOT NULL,
  last_seen_at_ms    BIGINT NOT NULL,
  expires_at_ms      BIGINT NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Node pairing + OAuth (tenant-scoped)
-- ---------------------------------------------------------------------------

CREATE TABLE node_pairings (
  pairing_id BIGSERIAL PRIMARY KEY,
  tenant_id  UUID NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('pending','approved','denied','revoked')),
  node_id    TEXT NOT NULL,
  pubkey     TEXT,
  label      TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by_json TEXT,
  resolution_reason TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  trust_level TEXT NOT NULL DEFAULT 'remote' CHECK (trust_level IN ('local','remote')),
  capability_allowlist_json TEXT NOT NULL DEFAULT '[]',
  scoped_token_sha256 TEXT,
  CONSTRAINT node_pairings_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  CONSTRAINT node_pairings_tenant_node_id_uq UNIQUE (tenant_id, node_id)
);

CREATE TABLE oauth_pending (
  tenant_id     UUID NOT NULL,
  state         TEXT NOT NULL,
  provider_id   TEXT NOT NULL,
  agent_key     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  pkce_verifier TEXT NOT NULL,
  redirect_uri  TEXT NOT NULL,
  scopes        TEXT NOT NULL,
  mode          TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  PRIMARY KEY (tenant_id, state),
  CONSTRAINT oauth_pending_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE oauth_refresh_leases (
  tenant_id           UUID NOT NULL,
  auth_profile_id     UUID NOT NULL,
  lease_owner         TEXT NOT NULL,
  lease_expires_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, auth_profile_id),
  CONSTRAINT oauth_refresh_leases_profile_fk
    FOREIGN KEY (tenant_id, auth_profile_id) REFERENCES auth_profiles(tenant_id, auth_profile_id) ON DELETE CASCADE
);

CREATE TABLE peer_identity_links (
  tenant_id        UUID NOT NULL,
  channel          TEXT NOT NULL,
  account          TEXT NOT NULL,
  provider_peer_id TEXT NOT NULL,
  canonical_peer_id TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, channel, account, provider_peer_id)
);

-- ---------------------------------------------------------------------------
-- Routing configs (tenant-scoped; default tenant for legacy callers)
-- ---------------------------------------------------------------------------

CREATE TABLE routing_configs (
  revision BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  config_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  reverted_from_revision BIGINT,
  CONSTRAINT routing_configs_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Models dev cache (default tenant for legacy callers)
-- ---------------------------------------------------------------------------

CREATE TABLE models_dev_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  fetched_at TIMESTAMPTZ NULL,
  etag TEXT NULL,
  sha256 TEXT NOT NULL,
  json TEXT NOT NULL,
  source TEXT NOT NULL,
  last_error TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT models_dev_cache_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE models_dev_refresh_leases (
  key TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  lease_owner TEXT NOT NULL,
  lease_expires_at_ms BIGINT NOT NULL,
  CONSTRAINT models_dev_refresh_leases_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- WorkBoard
-- ---------------------------------------------------------------------------

CREATE TABLE work_items (
  tenant_id    UUID NOT NULL,
  work_item_id UUID NOT NULL,
  agent_id     UUID NOT NULL,
  workspace_id UUID NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('action','initiative')),
  status       TEXT NOT NULL CHECK (status IN ('backlog','ready','doing','blocked','done','failed','cancelled')),
  priority     INTEGER NOT NULL DEFAULT 0,
  title        TEXT NOT NULL,
  acceptance_json TEXT,
  fingerprint_json TEXT,
  budgets_json TEXT,
  parent_work_item_id UUID,
  created_from_session_id UUID,
  created_from_session_key TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, work_item_id),
  CONSTRAINT work_items_membership_fk
    FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT work_items_parent_fk
    FOREIGN KEY (tenant_id, parent_work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE SET NULL,
  CONSTRAINT work_items_session_fk
    FOREIGN KEY (tenant_id, created_from_session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE SET NULL
);

CREATE TABLE work_item_tasks (
  tenant_id         UUID NOT NULL,
  task_id           UUID NOT NULL,
  work_item_id      UUID NOT NULL,
  status            TEXT NOT NULL,
  depends_on_json   TEXT NOT NULL DEFAULT '[]',
  execution_profile TEXT NOT NULL,
  side_effect_class TEXT NOT NULL,
  run_id            UUID,
  approval_id       UUID,
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  result_summary    TEXT,
  lease_owner       TEXT,
  lease_expires_at_ms BIGINT,
  artifacts_json    TEXT NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, task_id),
  CONSTRAINT work_item_tasks_item_fk
    FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE CASCADE,
  CONSTRAINT work_item_tasks_run_fk
    FOREIGN KEY (tenant_id, run_id) REFERENCES execution_runs(tenant_id, run_id) ON DELETE SET NULL,
  CONSTRAINT work_item_tasks_approval_fk
    FOREIGN KEY (tenant_id, approval_id) REFERENCES approvals(tenant_id, approval_id) ON DELETE SET NULL
);

CREATE TABLE subagents (
  tenant_id    UUID NOT NULL,
  subagent_id  UUID NOT NULL,
  agent_id     UUID NOT NULL,
  workspace_id UUID NOT NULL,
  work_item_id UUID,
  work_item_task_id UUID,
  execution_profile TEXT NOT NULL,
  session_id   UUID,
  session_key  TEXT NOT NULL,
  lane         TEXT NOT NULL DEFAULT 'subagent',
  status       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ,
  close_reason TEXT,
  closed_at    TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, subagent_id),
  UNIQUE (tenant_id, session_id),
  UNIQUE (tenant_id, session_key),
  CONSTRAINT subagents_membership_fk
    FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT subagents_work_item_fk
    FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE SET NULL,
  CONSTRAINT subagents_task_fk
    FOREIGN KEY (tenant_id, work_item_task_id)
    REFERENCES work_item_tasks(tenant_id, task_id) ON DELETE SET NULL,
  CONSTRAINT subagents_session_fk
    FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE SET NULL
);

CREATE TABLE work_item_events (
  tenant_id   UUID NOT NULL,
  event_id    UUID NOT NULL,
  work_item_id UUID NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind        TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, event_id),
  CONSTRAINT work_item_events_item_fk
    FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE CASCADE
);

CREATE TABLE work_item_links (
  tenant_id UUID NOT NULL,
  work_item_id UUID NOT NULL,
  linked_work_item_id UUID NOT NULL,
  kind TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, work_item_id, linked_work_item_id, kind),
  CONSTRAINT work_item_links_item_fk
    FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE CASCADE,
  CONSTRAINT work_item_links_linked_fk
    FOREIGN KEY (tenant_id, linked_work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE CASCADE
);

CREATE TABLE work_artifacts (
  tenant_id   UUID NOT NULL,
  artifact_id UUID NOT NULL,
  agent_id    UUID NOT NULL,
  workspace_id UUID NOT NULL,
  work_item_id UUID,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body_md     TEXT,
  refs_json   TEXT NOT NULL DEFAULT '[]',
  confidence  DOUBLE PRECISION,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_run_id UUID,
  created_by_subagent_id UUID,
  provenance_json TEXT,
  PRIMARY KEY (tenant_id, artifact_id),
  CONSTRAINT work_artifacts_membership_fk
    FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT work_artifacts_item_fk
    FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE SET NULL,
  CONSTRAINT work_artifacts_run_fk
    FOREIGN KEY (tenant_id, created_by_run_id) REFERENCES execution_runs(tenant_id, run_id) ON DELETE SET NULL,
  CONSTRAINT work_artifacts_subagent_fk
    FOREIGN KEY (tenant_id, created_by_subagent_id) REFERENCES subagents(tenant_id, subagent_id) ON DELETE SET NULL
);

CREATE TABLE work_decisions (
  tenant_id    UUID NOT NULL,
  decision_id  UUID NOT NULL,
  agent_id     UUID NOT NULL,
  workspace_id UUID NOT NULL,
  work_item_id UUID,
  question     TEXT NOT NULL,
  chosen       TEXT NOT NULL,
  alternatives_json TEXT NOT NULL DEFAULT '[]',
  rationale_md TEXT NOT NULL,
  input_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_run_id UUID,
  created_by_subagent_id UUID,
  PRIMARY KEY (tenant_id, decision_id),
  CONSTRAINT work_decisions_membership_fk
    FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT work_decisions_item_fk
    FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE SET NULL,
  CONSTRAINT work_decisions_run_fk
    FOREIGN KEY (tenant_id, created_by_run_id) REFERENCES execution_runs(tenant_id, run_id) ON DELETE SET NULL,
  CONSTRAINT work_decisions_subagent_fk
    FOREIGN KEY (tenant_id, created_by_subagent_id) REFERENCES subagents(tenant_id, subagent_id) ON DELETE SET NULL
);

CREATE TABLE work_signals (
  tenant_id     UUID NOT NULL,
  signal_id     UUID NOT NULL,
  agent_id      UUID NOT NULL,
  workspace_id  UUID NOT NULL,
  work_item_id  UUID,
  trigger_kind  TEXT NOT NULL,
  trigger_spec_json TEXT NOT NULL,
  payload_json  TEXT,
  status        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_fired_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, signal_id),
  CONSTRAINT work_signals_membership_fk
    FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT work_signals_item_fk
    FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE SET NULL
);

CREATE TABLE work_signal_firings (
  tenant_id UUID NOT NULL,
  firing_id UUID NOT NULL,
  signal_id UUID NOT NULL,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms BIGINT,
  lease_owner TEXT,
  lease_expires_at_ms BIGINT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, firing_id),
  UNIQUE (tenant_id, signal_id, dedupe_key),
  CONSTRAINT work_signal_firings_signal_fk
    FOREIGN KEY (tenant_id, signal_id) REFERENCES work_signals(tenant_id, signal_id) ON DELETE CASCADE
);

CREATE TABLE work_item_state_kv (
  tenant_id UUID NOT NULL,
  agent_id  UUID NOT NULL,
  workspace_id UUID NOT NULL,
  work_item_id UUID NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_run_id UUID,
  provenance_json TEXT,
  PRIMARY KEY (tenant_id, agent_id, workspace_id, work_item_id, key),
  CONSTRAINT work_item_state_kv_item_fk
    FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_items(tenant_id, work_item_id) ON DELETE CASCADE,
  CONSTRAINT work_item_state_kv_run_fk
    FOREIGN KEY (tenant_id, updated_by_run_id) REFERENCES execution_runs(tenant_id, run_id) ON DELETE SET NULL
);

CREATE TABLE agent_state_kv (
  tenant_id UUID NOT NULL,
  agent_id  UUID NOT NULL,
  workspace_id UUID NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_run_id UUID,
  provenance_json TEXT,
  PRIMARY KEY (tenant_id, agent_id, workspace_id, key),
  CONSTRAINT agent_state_kv_run_fk
    FOREIGN KEY (tenant_id, updated_by_run_id) REFERENCES execution_runs(tenant_id, run_id) ON DELETE SET NULL
);

CREATE TABLE work_scope_activity (
  tenant_id UUID NOT NULL,
  agent_id  UUID NOT NULL,
  workspace_id UUID NOT NULL,
  last_active_session_key TEXT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, agent_id, workspace_id)
);

-- ---------------------------------------------------------------------------
-- Memory (v1, tenant-safe)
-- ---------------------------------------------------------------------------

CREATE TABLE memory_items (
  tenant_id      UUID NOT NULL,
  agent_id       UUID NOT NULL,
  memory_item_id UUID NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('fact','note','procedure','episode')),
  sensitivity    TEXT NOT NULL DEFAULT 'private' CHECK (sensitivity IN ('public','private','sensitive')),
  confidence     DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  key            TEXT,
  value_json     TEXT,
  observed_at    TEXT,
  title          TEXT,
  body_md        TEXT,
  occurred_at    TEXT,
  summary_md     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, agent_id, memory_item_id),
  CONSTRAINT memory_items_agent_fk FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

CREATE TABLE memory_item_provenance (
  tenant_id      UUID NOT NULL,
  agent_id       UUID NOT NULL,
  memory_item_id UUID NOT NULL,
  source_kind    TEXT NOT NULL,
  channel        TEXT,
  thread_id      TEXT,
  session_id     TEXT,
  message_id     TEXT,
  tool_call_id   TEXT,
  refs_json      TEXT NOT NULL DEFAULT '[]',
  metadata_json  TEXT,
  PRIMARY KEY (tenant_id, agent_id, memory_item_id),
  CONSTRAINT memory_item_provenance_item_fk
    FOREIGN KEY (tenant_id, agent_id, memory_item_id)
    REFERENCES memory_items(tenant_id, agent_id, memory_item_id) ON DELETE CASCADE
);

CREATE TABLE memory_item_tags (
  tenant_id      UUID NOT NULL,
  agent_id       UUID NOT NULL,
  memory_item_id UUID NOT NULL,
  tag            TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, agent_id, memory_item_id, tag),
  CONSTRAINT memory_item_tags_item_fk
    FOREIGN KEY (tenant_id, agent_id, memory_item_id)
    REFERENCES memory_items(tenant_id, agent_id, memory_item_id) ON DELETE CASCADE
);

CREATE TABLE memory_tombstones (
  tenant_id      UUID NOT NULL,
  agent_id       UUID NOT NULL,
  memory_item_id UUID NOT NULL,
  deleted_at     TIMESTAMPTZ NOT NULL,
  deleted_by     TEXT NOT NULL,
  reason         TEXT,
  PRIMARY KEY (tenant_id, agent_id, memory_item_id)
);

CREATE TABLE memory_item_embeddings (
  tenant_id       UUID NOT NULL,
  agent_id        UUID NOT NULL,
  memory_item_id  UUID NOT NULL,
  embedding_id    TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  vector_data     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, agent_id, memory_item_id, embedding_id),
  CONSTRAINT memory_item_embeddings_item_fk
    FOREIGN KEY (tenant_id, agent_id, memory_item_id)
    REFERENCES memory_items(tenant_id, agent_id, memory_item_id) ON DELETE CASCADE
);

CREATE TABLE vector_metadata (
  vector_metadata_id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  agent_id  UUID NOT NULL,
  embedding_id TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  label TEXT,
  metadata_json TEXT,
  vector_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vector_metadata_tenant_embedding_uq UNIQUE (tenant_id, embedding_id),
  CONSTRAINT vector_metadata_agent_fk FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Seed default tenant/agent/workspace
-- ---------------------------------------------------------------------------

INSERT INTO tenants (tenant_id, tenant_key)
VALUES ('00000000-0000-4000-8000-000000000001'::uuid, 'default')
ON CONFLICT (tenant_key) DO NOTHING;

INSERT INTO agents (tenant_id, agent_id, agent_key)
VALUES (
  '00000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-4000-8000-000000000002'::uuid,
  'default'
)
ON CONFLICT (tenant_id, agent_key) DO NOTHING;

INSERT INTO workspaces (tenant_id, workspace_id, workspace_key)
VALUES (
  '00000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-4000-8000-000000000003'::uuid,
  'default'
)
ON CONFLICT (tenant_id, workspace_key) DO NOTHING;

INSERT INTO agent_workspaces (tenant_id, agent_id, workspace_id)
VALUES (
  '00000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-4000-8000-000000000002'::uuid,
  '00000000-0000-4000-8000-000000000003'::uuid
)
ON CONFLICT (tenant_id, agent_id, workspace_id) DO NOTHING;
