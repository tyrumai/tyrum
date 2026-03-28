ALTER TABLE work_item_tasks RENAME COLUMN run_id TO turn_id;

ALTER TABLE work_artifacts RENAME COLUMN created_by_run_id TO created_by_turn_id;
ALTER TABLE work_decisions RENAME COLUMN created_by_run_id TO created_by_turn_id;

ALTER TABLE work_item_state_kv RENAME COLUMN updated_by_run_id TO updated_by_turn_id;
ALTER TABLE agent_state_kv RENAME COLUMN updated_by_run_id TO updated_by_turn_id;

DROP INDEX IF EXISTS subagents_parent_conversation_key_idx;
CREATE INDEX IF NOT EXISTS subagents_parent_conversation_key_idx
ON subagents (tenant_id, agent_id, workspace_id, parent_conversation_key, updated_at DESC);
