CREATE TABLE dispatch_records (
  tenant_id             UUID NOT NULL,
  dispatch_id           UUID NOT NULL,
  turn_id               UUID,
  turn_item_id          UUID,
  workflow_run_step_id  UUID,
  requested_node_id     TEXT,
  selected_node_id      TEXT,
  capability            TEXT NOT NULL,
  action_json           JSONB NOT NULL,
  task_id               TEXT,
  status                TEXT NOT NULL CHECK (status IN ('dispatched','succeeded','failed')),
  result_json           JSONB,
  evidence_json         JSONB,
  error                 TEXT,
  policy_snapshot_id    UUID,
  connection_id         TEXT,
  edge_id               TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, dispatch_id),
  CONSTRAINT dispatch_records_turn_fk
    FOREIGN KEY (tenant_id, turn_id)
    REFERENCES turns(tenant_id, turn_id) ON DELETE SET NULL (turn_id),
  CONSTRAINT dispatch_records_turn_item_fk
    FOREIGN KEY (tenant_id, turn_item_id)
    REFERENCES turn_items(tenant_id, turn_item_id) ON DELETE SET NULL (turn_item_id),
  CONSTRAINT dispatch_records_workflow_run_step_fk
    FOREIGN KEY (tenant_id, workflow_run_step_id)
    REFERENCES workflow_run_steps(tenant_id, workflow_run_step_id) ON DELETE SET NULL (workflow_run_step_id),
  CONSTRAINT dispatch_records_policy_snapshot_fk
    FOREIGN KEY (tenant_id, policy_snapshot_id)
    REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL (policy_snapshot_id)
);

CREATE UNIQUE INDEX dispatch_records_task_id_unique
ON dispatch_records (tenant_id, task_id)
WHERE task_id IS NOT NULL;

CREATE INDEX dispatch_records_turn_created_idx
ON dispatch_records (tenant_id, turn_id, created_at DESC);

CREATE INDEX dispatch_records_workflow_step_created_idx
ON dispatch_records (tenant_id, workflow_run_step_id, created_at DESC);
