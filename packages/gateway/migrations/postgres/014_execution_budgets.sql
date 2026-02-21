-- Execution engine budgets (v1).
-- Runs may specify optional budgets that pause execution when exceeded.

ALTER TABLE execution_runs ADD COLUMN IF NOT EXISTS budgets_json TEXT;
ALTER TABLE execution_runs ADD COLUMN IF NOT EXISTS budget_overridden_at TEXT;

CREATE INDEX IF NOT EXISTS execution_runs_budget_overridden_at_idx ON execution_runs (budget_overridden_at);
