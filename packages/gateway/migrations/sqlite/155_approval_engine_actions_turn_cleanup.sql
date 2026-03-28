ALTER TABLE approval_engine_actions RENAME TO approval_engine_actions_legacy;

CREATE TABLE approval_engine_actions (
  tenant_id    TEXT NOT NULL,
  action_id    TEXT NOT NULL,
  approval_id  TEXT NOT NULL,
  action_kind  TEXT NOT NULL CHECK (action_kind IN ('resume_turn', 'cancel_turn')),
  resume_token TEXT,
  turn_id      TEXT,
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

INSERT INTO approval_engine_actions (
  tenant_id,
  action_id,
  approval_id,
  action_kind,
  resume_token,
  turn_id,
  reason,
  status,
  attempts,
  last_error,
  lease_owner,
  lease_expires_at_ms,
  created_at,
  updated_at,
  processed_at
)
SELECT
  tenant_id,
  action_id,
  approval_id,
  CASE action_kind
    WHEN 'resume_run' THEN 'resume_turn'
    WHEN 'cancel_run' THEN 'cancel_turn'
    ELSE action_kind
  END AS action_kind,
  resume_token,
  run_id,
  reason,
  status,
  attempts,
  last_error,
  lease_owner,
  lease_expires_at_ms,
  created_at,
  updated_at,
  processed_at
FROM approval_engine_actions_legacy;

DROP TABLE approval_engine_actions_legacy;

CREATE INDEX IF NOT EXISTS approval_engine_actions_claim_idx
ON approval_engine_actions (status, lease_expires_at_ms, updated_at);
