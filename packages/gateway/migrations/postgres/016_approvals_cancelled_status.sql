-- Allow approvals.status = 'cancelled' (align DB CHECK with types/schemas).

ALTER TABLE approvals
  DROP CONSTRAINT IF EXISTS approvals_status_check;

ALTER TABLE approvals
  ADD CONSTRAINT approvals_status_check
  CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'cancelled'));

