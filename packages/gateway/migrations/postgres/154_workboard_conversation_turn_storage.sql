ALTER TABLE work_item_tasks RENAME COLUMN run_id TO turn_id;

ALTER TABLE work_artifacts RENAME COLUMN created_by_run_id TO created_by_turn_id;

ALTER TABLE work_decisions RENAME COLUMN created_by_run_id TO created_by_turn_id;

ALTER TABLE work_item_state_kv RENAME COLUMN updated_by_run_id TO updated_by_turn_id;

ALTER TABLE agent_state_kv RENAME COLUMN updated_by_run_id TO updated_by_turn_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_item_tasks_run_fk'
  ) THEN
    EXECUTE 'ALTER TABLE work_item_tasks RENAME CONSTRAINT work_item_tasks_run_fk TO work_item_tasks_turn_fk';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_artifacts_run_fk'
  ) THEN
    EXECUTE 'ALTER TABLE work_artifacts RENAME CONSTRAINT work_artifacts_run_fk TO work_artifacts_turn_fk';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_decisions_run_fk'
  ) THEN
    EXECUTE 'ALTER TABLE work_decisions RENAME CONSTRAINT work_decisions_run_fk TO work_decisions_turn_fk';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_item_state_kv_run_fk'
  ) THEN
    EXECUTE 'ALTER TABLE work_item_state_kv RENAME CONSTRAINT work_item_state_kv_run_fk TO work_item_state_kv_turn_fk';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_state_kv_run_fk'
  ) THEN
    EXECUTE 'ALTER TABLE agent_state_kv RENAME CONSTRAINT agent_state_kv_run_fk TO agent_state_kv_turn_fk';
  END IF;
END
$$ LANGUAGE plpgsql;
