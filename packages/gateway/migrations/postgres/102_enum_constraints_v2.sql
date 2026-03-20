-- Tyrum Gateway schema v2 (Postgres) — enum constraints for stable status/kind columns.
--
-- Goal: align DB-level integrity with gateway-owned enums (and protect state machines
-- from typo values). This migration is written to be rolling-upgrade safe by
-- normalizing legacy/invalid stored values before applying CHECK constraints.

-- ---------------------------------------------------------------------------
-- Plans / planner
-- ---------------------------------------------------------------------------

UPDATE plans
SET kind = 'audit'
WHERE kind NOT IN ('audit', 'planner');

UPDATE plans
SET status = 'active'
WHERE status NOT IN ('active', 'success', 'escalate', 'failure');

ALTER TABLE plans
  ADD CONSTRAINT plans_kind_check CHECK (kind IN ('audit', 'planner')),
  ADD CONSTRAINT plans_status_check CHECK (status IN ('active', 'success', 'escalate', 'failure'));

-- ---------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------

UPDATE approvals
SET kind = 'other'
WHERE kind NOT IN (
  'spend',
  'pii',
  'workflow_step',
  'policy',
  'budget',
  'pairing',
  'takeover',
  'intent',
  'retry',
  'connector.send',
  'work.intervention',
  'other'
);

UPDATE approvals
SET status = 'pending'
WHERE status NOT IN ('pending', 'approved', 'denied', 'expired', 'cancelled');

ALTER TABLE approvals
  ADD CONSTRAINT approvals_kind_check CHECK (
    kind IN (
      'spend',
      'pii',
      'workflow_step',
      'policy',
      'budget',
      'pairing',
      'takeover',
      'intent',
      'retry',
      'connector.send',
      'work.intervention',
      'other'
    )
  ),
  ADD CONSTRAINT approvals_status_check CHECK (
    status IN ('pending', 'approved', 'denied', 'expired', 'cancelled')
  );
