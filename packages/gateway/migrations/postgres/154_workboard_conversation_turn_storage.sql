ALTER TABLE work_items RENAME COLUMN created_from_session_id TO created_from_conversation_id;
ALTER TABLE work_items RENAME COLUMN created_from_session_key TO created_from_conversation_key;

ALTER TABLE work_item_tasks RENAME COLUMN run_id TO turn_id;

ALTER TABLE subagents RENAME COLUMN session_id TO conversation_id;
ALTER TABLE subagents RENAME COLUMN session_key TO conversation_key;
ALTER TABLE subagents RENAME COLUMN parent_session_key TO parent_conversation_key;

ALTER TABLE work_artifacts RENAME COLUMN created_by_run_id TO created_by_turn_id;

ALTER TABLE work_decisions RENAME COLUMN created_by_run_id TO created_by_turn_id;

ALTER TABLE work_item_state_kv RENAME COLUMN updated_by_run_id TO updated_by_turn_id;

ALTER TABLE agent_state_kv RENAME COLUMN updated_by_run_id TO updated_by_turn_id;

ALTER TABLE work_scope_activity RENAME COLUMN last_active_session_key TO last_active_conversation_key;

ALTER TABLE work_clarifications RENAME COLUMN requested_for_session_key TO requested_for_conversation_key;
ALTER TABLE work_clarifications RENAME COLUMN answered_by_session_key TO answered_by_conversation_key;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_items_session_fk'
  ) THEN
    EXECUTE 'ALTER TABLE work_items RENAME CONSTRAINT work_items_session_fk TO work_items_conversation_fk';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_item_tasks_run_fk'
  ) THEN
    EXECUTE 'ALTER TABLE work_item_tasks RENAME CONSTRAINT work_item_tasks_run_fk TO work_item_tasks_turn_fk';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subagents_session_fk'
  ) THEN
    EXECUTE 'ALTER TABLE subagents RENAME CONSTRAINT subagents_session_fk TO subagents_conversation_fk';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subagents_tenant_session_id_key'
  ) THEN
    EXECUTE 'ALTER TABLE subagents RENAME CONSTRAINT subagents_tenant_session_id_key TO subagents_tenant_conversation_id_key';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subagents_tenant_session_key_key'
  ) THEN
    EXECUTE 'ALTER TABLE subagents RENAME CONSTRAINT subagents_tenant_session_key_key TO subagents_tenant_conversation_key_key';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = 'subagents_parent_session_scope_idx'
  ) THEN
    EXECUTE 'ALTER INDEX subagents_parent_session_scope_idx RENAME TO subagents_parent_conversation_scope_idx';
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
