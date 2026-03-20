-- Clean-break approval/pairing review model:
-- - approvals and pairings use guardian-aware statuses directly
-- - request-time motivation is required
-- - unified review history lives in review_entries

CREATE TABLE IF NOT EXISTS review_entries (
  tenant_id              UUID NOT NULL,
  review_id              TEXT NOT NULL,
  target_type            TEXT NOT NULL CHECK (target_type IN ('approval', 'pairing')),
  target_id              TEXT NOT NULL,
  reviewer_kind          TEXT NOT NULL CHECK (reviewer_kind IN ('guardian', 'human', 'system')),
  reviewer_id            TEXT,
  state                  TEXT NOT NULL CHECK (
    state IN (
      'queued',
      'running',
      'requested_human',
      'approved',
      'denied',
      'expired',
      'cancelled',
      'revoked',
      'failed',
      'superseded'
    )
  ),
  reason                 TEXT,
  risk_level             TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  risk_score             DOUBLE PRECISION,
  evidence_json          TEXT,
  decision_payload_json  TEXT,
  created_at             TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  started_at             TEXT,
  completed_at           TEXT,
  PRIMARY KEY (tenant_id, review_id)
);

CREATE INDEX IF NOT EXISTS review_entries_target_idx
  ON review_entries (tenant_id, target_type, target_id, created_at DESC);

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS motivation TEXT,
  ADD COLUMN IF NOT EXISTS latest_review_id TEXT;

UPDATE approvals
SET motivation = COALESCE(
  NULLIF(
    TRIM(
      CAST(
        (
          CASE
            WHEN pg_input_is_valid(context_json, 'jsonb') THEN context_json::jsonb
            ELSE '{}'::jsonb
          END ->> 'paused_detail'
        ) AS TEXT
      )
    ),
    ''
  ),
  prompt
)
WHERE motivation IS NULL OR TRIM(motivation) = '';

UPDATE approvals
SET kind = 'policy'
WHERE kind NOT IN (
  'workflow_step',
  'policy',
  'budget',
  'takeover',
  'intent',
  'retry',
  'connector.send',
  'work.intervention'
);

UPDATE approvals
SET status = CASE
  WHEN status = 'pending' THEN 'awaiting_human'
  WHEN status IN ('approved', 'denied', 'expired', 'cancelled') THEN status
  ELSE 'awaiting_human'
END;

ALTER TABLE approvals
  ALTER COLUMN motivation SET NOT NULL;

ALTER TABLE approvals
  DROP COLUMN IF EXISTS resolved_at,
  DROP COLUMN IF EXISTS resolution_json;

ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_kind_check;
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_status_check;
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_latest_review_fk;

ALTER TABLE approvals
  ADD CONSTRAINT approvals_kind_check CHECK (
    kind IN (
      'workflow_step',
      'policy',
      'budget',
      'takeover',
      'intent',
      'retry',
      'connector.send',
      'work.intervention'
    )
  ),
  ADD CONSTRAINT approvals_status_check CHECK (
    status IN (
      'queued',
      'reviewing',
      'awaiting_human',
      'approved',
      'denied',
      'expired',
      'cancelled'
    )
  ),
  ADD CONSTRAINT approvals_latest_review_fk
    FOREIGN KEY (tenant_id, latest_review_id)
    REFERENCES review_entries(tenant_id, review_id)
    ON DELETE SET NULL;

ALTER TABLE node_pairings
  ADD COLUMN IF NOT EXISTS motivation TEXT,
  ADD COLUMN IF NOT EXISTS latest_review_id TEXT;

UPDATE node_pairings
SET motivation = COALESCE(
  NULLIF(TRIM(resolution_reason), ''),
  'Node requested pairing; evaluate trust level and allowed capabilities before enabling node actions.'
)
WHERE motivation IS NULL OR TRIM(motivation) = '';

UPDATE node_pairings
SET status = CASE
  WHEN status = 'pending' THEN 'awaiting_human'
  WHEN status IN ('approved', 'denied', 'revoked') THEN status
  ELSE 'awaiting_human'
END;

ALTER TABLE node_pairings
  ALTER COLUMN motivation SET NOT NULL;

ALTER TABLE node_pairings
  DROP COLUMN IF EXISTS resolved_at,
  DROP COLUMN IF EXISTS resolved_by_json,
  DROP COLUMN IF EXISTS resolution_reason;

ALTER TABLE node_pairings DROP CONSTRAINT IF EXISTS node_pairings_status_check;
ALTER TABLE node_pairings DROP CONSTRAINT IF EXISTS node_pairings_latest_review_fk;

ALTER TABLE node_pairings
  ADD CONSTRAINT node_pairings_status_check CHECK (
    status IN ('queued', 'reviewing', 'awaiting_human', 'approved', 'denied', 'revoked')
  ),
  ADD CONSTRAINT node_pairings_latest_review_fk
    FOREIGN KEY (tenant_id, latest_review_id)
    REFERENCES review_entries(tenant_id, review_id)
    ON DELETE SET NULL;
