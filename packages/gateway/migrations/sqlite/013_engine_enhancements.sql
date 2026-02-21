-- 013: Engine budget, rollback, queue mode, policy snapshot, approval shape
ALTER TABLE execution_runs ADD COLUMN budget_tokens INTEGER;
ALTER TABLE execution_runs ADD COLUMN spent_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE execution_runs ADD COLUMN queue_mode TEXT NOT NULL DEFAULT 'collect';
ALTER TABLE execution_steps ADD COLUMN rollback_hint TEXT;
ALTER TABLE execution_steps ADD COLUMN policy_snapshot_id TEXT;
ALTER TABLE approvals ADD COLUMN estimated_cost_micros INTEGER;
ALTER TABLE approvals ADD COLUMN items_preview_json TEXT;
ALTER TABLE approvals ADD COLUMN suggested_overrides_json TEXT;
