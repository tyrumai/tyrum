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

DROP INDEX IF EXISTS subagents_parent_session_scope_idx;
CREATE INDEX IF NOT EXISTS subagents_parent_conversation_scope_idx
ON subagents (tenant_id, agent_id, workspace_id, parent_conversation_key, updated_at DESC);
