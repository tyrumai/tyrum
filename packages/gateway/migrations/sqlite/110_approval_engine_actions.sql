-- Durable approval engine actions (resume/cancel) processed under a DB lease.
CREATE TABLE IF NOT EXISTS approval_engine_actions (
  tenant_id    TEXT NOT NULL,
  action_id    TEXT NOT NULL,
  approval_id  TEXT NOT NULL,
  action_kind  TEXT NOT NULL CHECK (action_kind IN ('resume_run', 'cancel_run')),
  resume_token TEXT,
  run_id       TEXT,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  lease_owner  TEXT,
  lease_expires_at_ms INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  PRIMARY KEY (tenant_id, action_id),
  UNIQUE (tenant_id, approval_id, action_kind),
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approvals(tenant_id, approval_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS approval_engine_actions_claim_idx
ON approval_engine_actions (status, lease_expires_at_ms, updated_at);
