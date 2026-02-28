-- WorkBoard + drilldown + subagents persistence (v1).

CREATE TABLE IF NOT EXISTS work_items (
  work_item_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT NOT NULL DEFAULT 'default',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL CHECK (kind IN ('action', 'initiative')),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('backlog', 'ready', 'doing', 'blocked', 'done', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  acceptance_json TEXT,
  fingerprint_json TEXT,
  budgets_json TEXT,
  created_from_session_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ,
  parent_work_item_id TEXT,
  FOREIGN KEY (parent_work_item_id) REFERENCES work_items(work_item_id)
);

CREATE INDEX IF NOT EXISTS work_items_scope_status_created_at_idx
ON work_items (tenant_id, agent_id, workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS work_items_scope_kind_created_at_idx
ON work_items (tenant_id, agent_id, workspace_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS work_items_parent_work_item_id_idx ON work_items (parent_work_item_id);
CREATE INDEX IF NOT EXISTS work_items_last_active_at_idx ON work_items (last_active_at);

CREATE TABLE IF NOT EXISTS work_item_tasks (
  task_id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'leased', 'running', 'paused', 'completed', 'failed', 'cancelled', 'skipped')),
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  execution_profile TEXT NOT NULL,
  side_effect_class TEXT NOT NULL,
  run_id TEXT,
  approval_id BIGINT,
  artifacts_json TEXT NOT NULL DEFAULT '[]',
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  result_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (work_item_id) REFERENCES work_items(work_item_id),
  FOREIGN KEY (run_id) REFERENCES execution_runs(run_id),
  FOREIGN KEY (approval_id) REFERENCES approvals(id)
);

CREATE INDEX IF NOT EXISTS work_item_tasks_work_item_id_idx ON work_item_tasks (work_item_id);
CREATE INDEX IF NOT EXISTS work_item_tasks_status_idx ON work_item_tasks (status);
CREATE INDEX IF NOT EXISTS work_item_tasks_run_id_idx ON work_item_tasks (run_id);
CREATE INDEX IF NOT EXISTS work_item_tasks_approval_id_idx ON work_item_tasks (approval_id);

CREATE TABLE IF NOT EXISTS subagents (
  subagent_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT NOT NULL DEFAULT 'default',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  work_item_id TEXT,
  work_item_task_id TEXT,
  execution_profile TEXT NOT NULL,
  session_key TEXT NOT NULL UNIQUE,
  lane TEXT NOT NULL DEFAULT 'subagent',
  status TEXT NOT NULL CHECK (status IN ('running', 'closing', 'closed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_heartbeat_at TIMESTAMPTZ,
  close_reason TEXT,
  closed_at TIMESTAMPTZ,
  FOREIGN KEY (work_item_id) REFERENCES work_items(work_item_id),
  FOREIGN KEY (work_item_task_id) REFERENCES work_item_tasks(task_id)
);

CREATE INDEX IF NOT EXISTS subagents_scope_status_updated_at_idx
ON subagents (tenant_id, agent_id, workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS subagents_work_item_id_idx ON subagents (work_item_id);
CREATE INDEX IF NOT EXISTS subagents_work_item_task_id_idx ON subagents (work_item_task_id);

CREATE TABLE IF NOT EXISTS work_item_events (
  event_id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (work_item_id) REFERENCES work_items(work_item_id)
);

CREATE INDEX IF NOT EXISTS work_item_events_work_item_id_created_at_idx
ON work_item_events (work_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS work_item_links (
  work_item_id TEXT NOT NULL,
  linked_work_item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (work_item_id, linked_work_item_id, kind),
  FOREIGN KEY (work_item_id) REFERENCES work_items(work_item_id),
  FOREIGN KEY (linked_work_item_id) REFERENCES work_items(work_item_id)
);

CREATE INDEX IF NOT EXISTS work_item_links_work_item_id_idx ON work_item_links (work_item_id);
CREATE INDEX IF NOT EXISTS work_item_links_linked_work_item_id_idx ON work_item_links (linked_work_item_id);

CREATE TABLE IF NOT EXISTS work_artifacts (
  artifact_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT NOT NULL DEFAULT 'default',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  work_item_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT,
  refs_json TEXT NOT NULL DEFAULT '[]',
  confidence DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_run_id TEXT,
  created_by_subagent_id TEXT,
  provenance_json TEXT,
  FOREIGN KEY (work_item_id) REFERENCES work_items(work_item_id),
  FOREIGN KEY (created_by_run_id) REFERENCES execution_runs(run_id),
  FOREIGN KEY (created_by_subagent_id) REFERENCES subagents(subagent_id)
);

CREATE INDEX IF NOT EXISTS work_artifacts_scope_created_at_idx
ON work_artifacts (tenant_id, agent_id, workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS work_artifacts_work_item_id_created_at_idx
ON work_artifacts (work_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS work_artifacts_kind_created_at_idx ON work_artifacts (kind, created_at DESC);

CREATE TABLE IF NOT EXISTS work_decisions (
  decision_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT NOT NULL DEFAULT 'default',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  work_item_id TEXT,
  question TEXT NOT NULL,
  chosen TEXT NOT NULL,
  alternatives_json TEXT NOT NULL DEFAULT '[]',
  rationale_md TEXT NOT NULL,
  input_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_run_id TEXT,
  created_by_subagent_id TEXT,
  FOREIGN KEY (work_item_id) REFERENCES work_items(work_item_id),
  FOREIGN KEY (created_by_run_id) REFERENCES execution_runs(run_id),
  FOREIGN KEY (created_by_subagent_id) REFERENCES subagents(subagent_id)
);

CREATE INDEX IF NOT EXISTS work_decisions_scope_created_at_idx
ON work_decisions (tenant_id, agent_id, workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS work_decisions_work_item_id_created_at_idx
ON work_decisions (work_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS work_signals (
  signal_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT NOT NULL DEFAULT 'default',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  work_item_id TEXT,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('time', 'event')),
  trigger_spec_json TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'fired', 'resolved', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_fired_at TIMESTAMPTZ,
  FOREIGN KEY (work_item_id) REFERENCES work_items(work_item_id)
);

CREATE INDEX IF NOT EXISTS work_signals_scope_status_created_at_idx
ON work_signals (tenant_id, agent_id, workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS work_signals_work_item_id_created_at_idx
ON work_signals (work_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS work_item_state_kv (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT NOT NULL DEFAULT 'default',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  work_item_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_run_id TEXT,
  provenance_json TEXT,
  PRIMARY KEY (tenant_id, agent_id, workspace_id, work_item_id, key),
  FOREIGN KEY (work_item_id) REFERENCES work_items(work_item_id),
  FOREIGN KEY (updated_by_run_id) REFERENCES execution_runs(run_id)
);

CREATE INDEX IF NOT EXISTS work_item_state_kv_work_item_id_updated_at_idx
ON work_item_state_kv (work_item_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_state_kv (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT NOT NULL DEFAULT 'default',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_run_id TEXT,
  provenance_json TEXT,
  PRIMARY KEY (tenant_id, agent_id, workspace_id, key),
  FOREIGN KEY (updated_by_run_id) REFERENCES execution_runs(run_id)
);

CREATE INDEX IF NOT EXISTS agent_state_kv_scope_updated_at_idx
ON agent_state_kv (tenant_id, agent_id, workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS work_scope_activity (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT NOT NULL DEFAULT 'default',
  workspace_id TEXT NOT NULL DEFAULT 'default',
  last_active_session_key TEXT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, agent_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS work_scope_activity_updated_at_ms_idx
ON work_scope_activity (updated_at_ms DESC);
