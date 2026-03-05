-- Enforce the audited approval/policy foreign keys while normalizing legacy
-- orphaned references to NULL before the new constraints land.

UPDATE approvals
SET run_id = NULL
WHERE run_id IS NOT NULL
  AND (CAST(tenant_id AS TEXT) || ':' || CAST(run_id AS TEXT)) NOT IN (
    SELECT CAST(tenant_id AS TEXT) || ':' || CAST(run_id AS TEXT)
    FROM execution_runs
  );

UPDATE approvals
SET step_id = NULL
WHERE step_id IS NOT NULL
  AND (CAST(tenant_id AS TEXT) || ':' || CAST(step_id AS TEXT)) NOT IN (
    SELECT CAST(tenant_id AS TEXT) || ':' || CAST(step_id AS TEXT)
    FROM execution_steps
  );

UPDATE approvals
SET attempt_id = NULL
WHERE attempt_id IS NOT NULL
  AND (CAST(tenant_id AS TEXT) || ':' || CAST(attempt_id AS TEXT)) NOT IN (
    SELECT CAST(tenant_id AS TEXT) || ':' || CAST(attempt_id AS TEXT)
    FROM execution_attempts
  );

UPDATE policy_overrides
SET created_from_approval_id = NULL
WHERE created_from_approval_id IS NOT NULL
  AND (CAST(tenant_id AS TEXT) || ':' || CAST(created_from_approval_id AS TEXT)) NOT IN (
    SELECT CAST(tenant_id AS TEXT) || ':' || CAST(approval_id AS TEXT)
    FROM approvals
  );

UPDATE channel_outbox
SET approval_id = NULL
WHERE approval_id IS NOT NULL
  AND (CAST(tenant_id AS TEXT) || ':' || CAST(approval_id AS TEXT)) NOT IN (
    SELECT CAST(tenant_id AS TEXT) || ':' || CAST(approval_id AS TEXT)
    FROM approvals
  );

ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_run_fk;
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_step_fk;
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_attempt_fk;

ALTER TABLE approvals
  ADD CONSTRAINT approvals_run_fk
  FOREIGN KEY (tenant_id, run_id)
  REFERENCES execution_runs(tenant_id, run_id)
  ON DELETE SET NULL;

ALTER TABLE approvals
  ADD CONSTRAINT approvals_step_fk
  FOREIGN KEY (tenant_id, step_id)
  REFERENCES execution_steps(tenant_id, step_id)
  ON DELETE SET NULL;

ALTER TABLE approvals
  ADD CONSTRAINT approvals_attempt_fk
  FOREIGN KEY (tenant_id, attempt_id)
  REFERENCES execution_attempts(tenant_id, attempt_id)
  ON DELETE SET NULL;

ALTER TABLE policy_overrides DROP CONSTRAINT IF EXISTS policy_overrides_created_from_approval_fk;

ALTER TABLE policy_overrides
  ADD CONSTRAINT policy_overrides_created_from_approval_fk
  FOREIGN KEY (tenant_id, created_from_approval_id)
  REFERENCES approvals(tenant_id, approval_id)
  ON DELETE SET NULL;

ALTER TABLE channel_outbox DROP CONSTRAINT IF EXISTS channel_outbox_approval_fk;

ALTER TABLE channel_outbox
  ADD CONSTRAINT channel_outbox_approval_fk
  FOREIGN KEY (tenant_id, approval_id)
  REFERENCES approvals(tenant_id, approval_id)
  ON DELETE SET NULL;
