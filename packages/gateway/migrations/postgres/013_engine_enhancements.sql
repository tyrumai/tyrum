-- 013: Engine budget, rollback, queue mode, policy snapshot, approval shape
ALTER TABLE execution_runs ADD COLUMN IF NOT EXISTS budget_tokens INTEGER;
ALTER TABLE execution_runs ADD COLUMN IF NOT EXISTS spent_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE execution_runs ADD COLUMN IF NOT EXISTS queue_mode TEXT NOT NULL DEFAULT 'collect';
ALTER TABLE execution_steps ADD COLUMN IF NOT EXISTS rollback_hint TEXT;
ALTER TABLE execution_steps ADD COLUMN IF NOT EXISTS policy_snapshot_id TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS estimated_cost_micros INTEGER;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS items_preview_json TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS suggested_overrides_json TEXT;
