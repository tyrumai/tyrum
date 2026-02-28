-- Persist policy decisions on execution attempts (SQLite).
-- Adds structured policy evaluation fields for auditability.

ALTER TABLE execution_attempts ADD COLUMN policy_snapshot_id TEXT;
ALTER TABLE execution_attempts ADD COLUMN policy_decision_json TEXT;
ALTER TABLE execution_attempts ADD COLUMN policy_applied_override_ids_json TEXT;

