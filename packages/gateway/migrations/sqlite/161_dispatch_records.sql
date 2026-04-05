CREATE TABLE dispatch_records (
  tenant_id             TEXT NOT NULL,
  dispatch_id           TEXT NOT NULL,
  turn_id               TEXT,
  turn_item_id          TEXT,
  workflow_run_step_id  TEXT,
  requested_node_id     TEXT,
  selected_node_id      TEXT,
  capability            TEXT NOT NULL,
  action_json           TEXT NOT NULL,
  task_id               TEXT,
  status                TEXT NOT NULL CHECK (status IN ('dispatched','succeeded','failed')),
  result_json           TEXT,
  evidence_json         TEXT,
  error                 TEXT,
  policy_snapshot_id    TEXT,
  connection_id         TEXT,
  edge_id               TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at          TEXT,
  PRIMARY KEY (tenant_id, dispatch_id),
  FOREIGN KEY (tenant_id, turn_id)
    REFERENCES turns(tenant_id, turn_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, turn_item_id)
    REFERENCES turn_items(tenant_id, turn_item_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, workflow_run_step_id)
    REFERENCES workflow_run_steps(tenant_id, workflow_run_step_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, policy_snapshot_id)
    REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX dispatch_records_task_id_unique
ON dispatch_records (tenant_id, task_id)
WHERE task_id IS NOT NULL;

CREATE INDEX dispatch_records_turn_created_idx
ON dispatch_records (tenant_id, turn_id, created_at DESC);

CREATE INDEX dispatch_records_workflow_step_created_idx
ON dispatch_records (tenant_id, workflow_run_step_id, created_at DESC);
