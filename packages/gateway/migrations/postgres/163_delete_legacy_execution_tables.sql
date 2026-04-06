ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_step_fk;
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_attempt_fk;

ALTER TABLE approvals
  DROP COLUMN IF EXISTS step_id,
  DROP COLUMN IF EXISTS attempt_id;

DROP TABLE IF EXISTS execution_attempts CASCADE;
DROP TABLE IF EXISTS execution_steps CASCADE;
