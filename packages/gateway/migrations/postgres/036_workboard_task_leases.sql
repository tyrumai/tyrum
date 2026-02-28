-- WorkBoard task leasing metadata (v1).

ALTER TABLE work_item_tasks ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE work_item_tasks ADD COLUMN IF NOT EXISTS lease_expires_at_ms BIGINT;

CREATE INDEX IF NOT EXISTS work_item_tasks_lease_expires_at_ms_idx
ON work_item_tasks (lease_expires_at_ms);

