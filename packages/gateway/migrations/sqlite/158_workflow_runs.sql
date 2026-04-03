CREATE TABLE workflow_runs (
  workflow_run_id      TEXT NOT NULL,
  tenant_id            TEXT NOT NULL,
  agent_id             TEXT NOT NULL,
  workspace_id         TEXT NOT NULL,
  run_key              TEXT NOT NULL,
  conversation_key     TEXT,
  status               TEXT NOT NULL CHECK (status IN ('queued','running','paused','succeeded','failed','cancelled')),
  trigger_json         TEXT NOT NULL,
  plan_id              TEXT,
  request_id           TEXT,
  input_json           TEXT,
  budgets_json         TEXT,
  policy_snapshot_id   TEXT,
  attempt              INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  current_step_index   INTEGER CHECK (current_step_index IS NULL OR current_step_index >= 0),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  started_at           TEXT,
  finished_at          TEXT,
  blocked_reason       TEXT CHECK (blocked_reason IS NULL OR blocked_reason IN ('approval','takeover','budget','manual','policy')),
  blocked_detail       TEXT,
  budget_overridden_at TEXT,
  lease_owner          TEXT,
  lease_expires_at_ms  INTEGER,
  checkpoint_json      TEXT,
  last_progress_at     TEXT,
  last_progress_json   TEXT,
  PRIMARY KEY (tenant_id, workflow_run_id),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, policy_snapshot_id)
    REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL
);

CREATE INDEX idx_workflow_runs_status
ON workflow_runs(tenant_id, status, updated_at DESC);

CREATE INDEX idx_workflow_runs_key_status
ON workflow_runs(tenant_id, run_key, status, created_at DESC);

CREATE TABLE workflow_run_steps (
  tenant_id                           TEXT NOT NULL,
  workflow_run_step_id                TEXT NOT NULL,
  workflow_run_id                     TEXT NOT NULL,
  step_index                          INTEGER NOT NULL CHECK (step_index >= 0),
  status                              TEXT NOT NULL CHECK (status IN ('queued','running','paused','succeeded','failed','cancelled','skipped')),
  action_json                         TEXT NOT NULL,
  created_at                          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                          TEXT NOT NULL DEFAULT (datetime('now')),
  started_at                          TEXT,
  finished_at                         TEXT,
  idempotency_key                     TEXT,
  postcondition_json                  TEXT,
  result_json                         TEXT,
  error                               TEXT,
  artifacts_json                      TEXT NOT NULL DEFAULT '[]',
  metadata_json                       TEXT,
  cost_json                           TEXT,
  policy_snapshot_id                  TEXT,
  policy_decision_json                TEXT,
  policy_applied_override_ids_json    TEXT,
  attempt_count                       INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts                        INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts >= 1),
  timeout_ms                          INTEGER NOT NULL DEFAULT 60000 CHECK (timeout_ms > 0),
  PRIMARY KEY (tenant_id, workflow_run_step_id),
  UNIQUE (tenant_id, workflow_run_id, step_index),
  FOREIGN KEY (tenant_id, workflow_run_id)
    REFERENCES workflow_runs(tenant_id, workflow_run_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, policy_snapshot_id)
    REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL
);

CREATE INDEX idx_workflow_run_steps_status
ON workflow_run_steps(tenant_id, status, updated_at DESC);
