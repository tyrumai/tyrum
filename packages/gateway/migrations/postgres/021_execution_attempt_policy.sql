-- Persist policy decisions on execution attempts (Postgres).
-- Adds structured policy evaluation fields for auditability.

ALTER TABLE execution_attempts ADD COLUMN IF NOT EXISTS policy_snapshot_id TEXT;
ALTER TABLE execution_attempts ADD COLUMN IF NOT EXISTS policy_decision_json TEXT;
ALTER TABLE execution_attempts ADD COLUMN IF NOT EXISTS policy_applied_override_ids_json TEXT;

