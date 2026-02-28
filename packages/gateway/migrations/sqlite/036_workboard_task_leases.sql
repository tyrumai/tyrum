-- WorkBoard task leasing metadata (v1).

ALTER TABLE work_item_tasks ADD COLUMN lease_owner TEXT;
ALTER TABLE work_item_tasks ADD COLUMN lease_expires_at_ms INTEGER;

CREATE INDEX IF NOT EXISTS work_item_tasks_lease_expires_at_ms_idx
ON work_item_tasks (lease_expires_at_ms);

