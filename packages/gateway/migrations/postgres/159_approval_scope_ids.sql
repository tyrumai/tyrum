-- Add turn-item and workflow-run-step approval scope identifiers while keeping
-- the legacy execution-step columns until the runtime cutover lands.

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS turn_item_id UUID,
  ADD COLUMN IF NOT EXISTS workflow_run_step_id UUID;

UPDATE approvals
SET turn_item_id = NULL
WHERE turn_item_id IS NOT NULL
  AND (CAST(tenant_id AS TEXT) || ':' || CAST(turn_item_id AS TEXT)) NOT IN (
    SELECT CAST(tenant_id AS TEXT) || ':' || CAST(turn_item_id AS TEXT)
    FROM turn_items
  );

UPDATE approvals
SET workflow_run_step_id = NULL
WHERE workflow_run_step_id IS NOT NULL
  AND (CAST(tenant_id AS TEXT) || ':' || CAST(workflow_run_step_id AS TEXT)) NOT IN (
    SELECT CAST(tenant_id AS TEXT) || ':' || CAST(workflow_run_step_id AS TEXT)
    FROM workflow_run_steps
  );

ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_turn_item_fk;
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_workflow_run_step_fk;

ALTER TABLE approvals
  ADD CONSTRAINT approvals_turn_item_fk
  FOREIGN KEY (tenant_id, turn_item_id)
  REFERENCES turn_items(tenant_id, turn_item_id);

ALTER TABLE approvals
  ADD CONSTRAINT approvals_workflow_run_step_fk
  FOREIGN KEY (tenant_id, workflow_run_step_id)
  REFERENCES workflow_run_steps(tenant_id, workflow_run_step_id);
