-- Durable approval engine actions (resume/cancel) processed under a DB lease.
CREATE TABLE IF NOT EXISTS approval_engine_actions (
  tenant_id    UUID NOT NULL,
  action_id    UUID NOT NULL,
  approval_id  UUID NOT NULL,
  action_kind  TEXT NOT NULL CHECK (action_kind IN ('resume_run', 'cancel_run')),
  resume_token TEXT,
  run_id       UUID,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  lease_owner  TEXT,
  lease_expires_at_ms BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, action_id),
  UNIQUE (tenant_id, approval_id, action_kind),
  CONSTRAINT approval_engine_actions_approval_fk
    FOREIGN KEY (tenant_id, approval_id) REFERENCES approvals(tenant_id, approval_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS approval_engine_actions_claim_idx
ON approval_engine_actions (status, lease_expires_at_ms, updated_at);

