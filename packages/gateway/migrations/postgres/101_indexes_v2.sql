-- Tyrum Gateway schema v2 (Postgres) — indexes.

-- Identity
CREATE INDEX IF NOT EXISTS agents_tenant_agent_key_idx ON agents (tenant_id, agent_key);
CREATE INDEX IF NOT EXISTS workspaces_tenant_workspace_key_idx ON workspaces (tenant_id, workspace_key);
CREATE INDEX IF NOT EXISTS agent_workspaces_tenant_workspace_id_idx ON agent_workspaces (tenant_id, workspace_id);

-- Channels / sessions
CREATE INDEX IF NOT EXISTS sessions_tenant_updated_at_idx ON sessions (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS sessions_tenant_workspace_id_idx ON sessions (tenant_id, workspace_id);
CREATE INDEX IF NOT EXISTS sessions_tenant_agent_id_idx ON sessions (tenant_id, agent_id);

CREATE INDEX IF NOT EXISTS session_model_overrides_tenant_updated_at_idx
ON session_model_overrides (tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS session_provider_pins_tenant_session_id_idx
ON session_provider_pins (tenant_id, session_id);
CREATE INDEX IF NOT EXISTS session_provider_pins_tenant_auth_profile_id_idx
ON session_provider_pins (tenant_id, auth_profile_id);

CREATE INDEX IF NOT EXISTS channel_inbound_dedupe_expires_at_ms_idx
ON channel_inbound_dedupe (tenant_id, expires_at_ms);

CREATE INDEX IF NOT EXISTS channel_inbox_status_idx
ON channel_inbox (tenant_id, status);
CREATE INDEX IF NOT EXISTS channel_inbox_key_lane_idx
ON channel_inbox (tenant_id, key, lane);
CREATE INDEX IF NOT EXISTS channel_inbox_received_at_ms_idx
ON channel_inbox (tenant_id, received_at_ms);
CREATE INDEX IF NOT EXISTS channel_inbox_lease_expires_at_ms_idx
ON channel_inbox (tenant_id, lease_expires_at_ms);
CREATE INDEX IF NOT EXISTS channel_inbox_dedupe_lookup_idx
ON channel_inbox (tenant_id, source, thread_id, message_id);

CREATE INDEX IF NOT EXISTS channel_outbox_status_idx
ON channel_outbox (tenant_id, status);
CREATE INDEX IF NOT EXISTS channel_outbox_created_at_idx
ON channel_outbox (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS channel_outbox_lease_expires_at_ms_idx
ON channel_outbox (tenant_id, lease_expires_at_ms);
CREATE INDEX IF NOT EXISTS channel_outbox_approval_id_idx
ON channel_outbox (tenant_id, approval_id);
CREATE INDEX IF NOT EXISTS channel_outbox_session_id_idx
ON channel_outbox (tenant_id, session_id);

-- Secrets / auth
CREATE INDEX IF NOT EXISTS secret_versions_created_at_idx
ON secret_versions (tenant_id, secret_id, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_profiles_provider_idx
ON auth_profiles (tenant_id, provider_key);
CREATE INDEX IF NOT EXISTS auth_profile_secrets_secret_id_idx
ON auth_profile_secrets (tenant_id, secret_id);

-- Policy
CREATE INDEX IF NOT EXISTS policy_overrides_status_idx ON policy_overrides (tenant_id, status);
CREATE INDEX IF NOT EXISTS policy_overrides_agent_tool_idx ON policy_overrides (tenant_id, agent_id, tool_id);
CREATE INDEX IF NOT EXISTS policy_overrides_workspace_id_idx ON policy_overrides (tenant_id, workspace_id);

-- Plans / planner
CREATE INDEX IF NOT EXISTS plans_tenant_plan_key_idx ON plans (tenant_id, plan_key);
CREATE INDEX IF NOT EXISTS planner_events_tenant_plan_id_idx ON planner_events (tenant_id, plan_id);
CREATE INDEX IF NOT EXISTS planner_events_replay_id_idx ON planner_events (replay_id);

-- Watchers
CREATE INDEX IF NOT EXISTS watchers_active_idx ON watchers (tenant_id, active);
CREATE INDEX IF NOT EXISTS watchers_scope_idx ON watchers (tenant_id, agent_id, workspace_id);
CREATE INDEX IF NOT EXISTS watcher_firings_status_idx ON watcher_firings (tenant_id, status);
CREATE INDEX IF NOT EXISTS watcher_firings_scheduled_at_ms_idx ON watcher_firings (tenant_id, scheduled_at_ms);
CREATE INDEX IF NOT EXISTS watcher_firings_lease_expires_at_ms_idx
ON watcher_firings (tenant_id, lease_expires_at_ms);

-- Approvals
CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals (tenant_id, status);
CREATE INDEX IF NOT EXISTS approvals_expires_at_idx ON approvals (tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS approvals_session_id_idx ON approvals (tenant_id, session_id);
CREATE INDEX IF NOT EXISTS approvals_plan_id_idx ON approvals (tenant_id, plan_id);

-- Execution engine
CREATE INDEX IF NOT EXISTS execution_jobs_key_lane_idx ON execution_jobs (tenant_id, key, lane);
CREATE INDEX IF NOT EXISTS execution_jobs_status_idx ON execution_jobs (tenant_id, status);
CREATE INDEX IF NOT EXISTS execution_jobs_scope_idx ON execution_jobs (tenant_id, agent_id, workspace_id);
CREATE INDEX IF NOT EXISTS execution_jobs_policy_snapshot_id_idx
ON execution_jobs (tenant_id, policy_snapshot_id);

CREATE INDEX IF NOT EXISTS execution_runs_job_id_idx ON execution_runs (tenant_id, job_id);
CREATE INDEX IF NOT EXISTS execution_runs_status_idx ON execution_runs (tenant_id, status);
CREATE INDEX IF NOT EXISTS execution_runs_budget_overridden_at_idx
ON execution_runs (tenant_id, budget_overridden_at);
CREATE INDEX IF NOT EXISTS execution_runs_policy_snapshot_id_idx
ON execution_runs (tenant_id, policy_snapshot_id);

CREATE INDEX IF NOT EXISTS execution_steps_run_id_idx ON execution_steps (tenant_id, run_id);
CREATE INDEX IF NOT EXISTS execution_steps_status_idx ON execution_steps (tenant_id, status);

CREATE INDEX IF NOT EXISTS execution_attempts_step_id_idx
ON execution_attempts (tenant_id, step_id);
CREATE INDEX IF NOT EXISTS execution_attempts_lease_idx
ON execution_attempts (tenant_id, status, lease_expires_at_ms);
CREATE INDEX IF NOT EXISTS execution_attempts_policy_snapshot_id_idx
ON execution_attempts (tenant_id, policy_snapshot_id);

CREATE INDEX IF NOT EXISTS execution_artifacts_retention_expires_at_idx
ON execution_artifacts (tenant_id, retention_expires_at);
CREATE INDEX IF NOT EXISTS execution_artifacts_bytes_deleted_at_idx
ON execution_artifacts (tenant_id, bytes_deleted_at);
CREATE INDEX IF NOT EXISTS execution_artifacts_workspace_id_idx
ON execution_artifacts (tenant_id, workspace_id);
CREATE INDEX IF NOT EXISTS execution_artifacts_agent_id_idx
ON execution_artifacts (tenant_id, agent_id);
CREATE INDEX IF NOT EXISTS execution_artifacts_run_id_idx
ON execution_artifacts (tenant_id, run_id);
CREATE INDEX IF NOT EXISTS execution_artifacts_step_id_idx
ON execution_artifacts (tenant_id, step_id);
CREATE INDEX IF NOT EXISTS execution_artifacts_attempt_id_idx
ON execution_artifacts (tenant_id, attempt_id);
CREATE INDEX IF NOT EXISTS execution_artifacts_kind_idx
ON execution_artifacts (tenant_id, kind);
CREATE INDEX IF NOT EXISTS execution_artifacts_created_at_idx
ON execution_artifacts (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS resume_tokens_run_id_idx ON resume_tokens (tenant_id, run_id);
CREATE INDEX IF NOT EXISTS resume_tokens_expires_at_idx ON resume_tokens (tenant_id, expires_at);

CREATE INDEX IF NOT EXISTS lane_leases_expires_at_idx ON lane_leases (tenant_id, lease_expires_at_ms);
CREATE INDEX IF NOT EXISTS workspace_leases_expires_at_idx ON workspace_leases (tenant_id, lease_expires_at_ms);

CREATE INDEX IF NOT EXISTS concurrency_slots_lease_idx
ON concurrency_slots (tenant_id, scope, scope_id, lease_expires_at_ms);
CREATE INDEX IF NOT EXISTS concurrency_slots_attempt_idx
ON concurrency_slots (tenant_id, attempt_id);

-- Canvas
CREATE INDEX IF NOT EXISTS canvas_artifacts_workspace_id_idx
ON canvas_artifacts (tenant_id, workspace_id);
CREATE INDEX IF NOT EXISTS canvas_artifact_links_parent_idx
ON canvas_artifact_links (tenant_id, parent_kind, parent_id);

-- Context reports
CREATE INDEX IF NOT EXISTS context_reports_session_id_idx
ON context_reports (tenant_id, session_id);
CREATE INDEX IF NOT EXISTS context_reports_created_at_idx
ON context_reports (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS context_reports_run_id_idx
ON context_reports (tenant_id, run_id);

-- Secret resolution audit
CREATE INDEX IF NOT EXISTS secret_resolutions_handle_id_idx
ON secret_resolutions (tenant_id, handle_id);
CREATE INDEX IF NOT EXISTS secret_resolutions_occurred_at_idx
ON secret_resolutions (tenant_id, occurred_at DESC);

-- Presence / backplane
CREATE INDEX IF NOT EXISTS connections_edge_id_idx ON connections (tenant_id, edge_id);
CREATE INDEX IF NOT EXISTS connections_expires_at_ms_idx ON connections (tenant_id, expires_at_ms);
CREATE INDEX IF NOT EXISTS outbox_tenant_id_id_idx ON outbox (tenant_id, id);
CREATE INDEX IF NOT EXISTS outbox_topic_idx ON outbox (tenant_id, topic);
CREATE INDEX IF NOT EXISTS outbox_target_edge_idx ON outbox (tenant_id, target_edge_id);

-- Node pairing
CREATE INDEX IF NOT EXISTS node_pairings_status_idx ON node_pairings (tenant_id, status);
CREATE INDEX IF NOT EXISTS node_pairings_last_seen_at_idx ON node_pairings (tenant_id, last_seen_at);
CREATE UNIQUE INDEX IF NOT EXISTS node_pairings_scoped_token_sha256_uq
  ON node_pairings (tenant_id, scoped_token_sha256)
  WHERE scoped_token_sha256 IS NOT NULL;

-- Peer identity links
CREATE INDEX IF NOT EXISTS peer_identity_links_canonical_peer_id_idx
ON peer_identity_links (tenant_id, canonical_peer_id);

-- Routing configs
CREATE INDEX IF NOT EXISTS routing_configs_revision_idx
ON routing_configs (tenant_id, revision DESC);
CREATE INDEX IF NOT EXISTS routing_configs_created_at_idx
ON routing_configs (tenant_id, created_at DESC);

-- WorkBoard
CREATE INDEX IF NOT EXISTS work_items_scope_status_updated_at_idx
ON work_items (tenant_id, agent_id, workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS work_item_tasks_work_item_id_idx
ON work_item_tasks (tenant_id, work_item_id);
CREATE INDEX IF NOT EXISTS work_item_tasks_lease_expires_at_ms_idx
ON work_item_tasks (tenant_id, lease_expires_at_ms);
CREATE INDEX IF NOT EXISTS subagents_scope_idx
ON subagents (tenant_id, agent_id, workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS work_item_events_work_item_id_created_at_idx
ON work_item_events (tenant_id, work_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS work_artifacts_scope_created_at_idx
ON work_artifacts (tenant_id, agent_id, workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS work_decisions_scope_created_at_idx
ON work_decisions (tenant_id, agent_id, workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS work_signals_scope_status_created_at_idx
ON work_signals (tenant_id, agent_id, workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS work_item_state_kv_work_item_id_updated_at_idx
ON work_item_state_kv (tenant_id, work_item_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS agent_state_kv_scope_updated_at_idx
ON agent_state_kv (tenant_id, agent_id, workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS work_scope_activity_updated_at_ms_idx
ON work_scope_activity (tenant_id, updated_at_ms DESC);
CREATE INDEX IF NOT EXISTS work_signal_firings_lease_expires_at_ms_idx
ON work_signal_firings (tenant_id, lease_expires_at_ms);

-- Memory
CREATE INDEX IF NOT EXISTS memory_items_created_at_idx
ON memory_items (tenant_id, agent_id, created_at DESC);
DO $$
BEGIN
  -- Keep this migration compatible with both historical schemas:
  -- - v2 rebuild initially created `vector_metadata.id` (then renamed in 103)
  -- - newer rebuilds create `vector_metadata.vector_metadata_id` directly
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vector_metadata'
      AND column_name = 'vector_metadata_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS vector_metadata_created_idx ON vector_metadata (tenant_id, created_at DESC, vector_metadata_id DESC)';
  ELSE
    EXECUTE 'CREATE INDEX IF NOT EXISTS vector_metadata_created_idx ON vector_metadata (tenant_id, created_at DESC, id DESC)';
  END IF;
END $$;
