-- tyrum:disable_foreign_keys
--
-- Clean-break approval/pairing review model:
-- - approvals and pairings use guardian-aware statuses directly
-- - request-time motivation is required
-- - unified review history lives in review_entries

CREATE TABLE review_entries (
  tenant_id           TEXT NOT NULL,
  review_id           TEXT NOT NULL,
  target_type         TEXT NOT NULL CHECK (target_type IN ('approval', 'pairing')),
  target_id           TEXT NOT NULL,
  reviewer_kind       TEXT NOT NULL CHECK (reviewer_kind IN ('guardian', 'human', 'system')),
  reviewer_id         TEXT,
  state               TEXT NOT NULL CHECK (
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
  reason              TEXT,
  risk_level          TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  risk_score          REAL,
  evidence_json       TEXT,
  decision_payload_json TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  started_at          TEXT,
  completed_at        TEXT,
  PRIMARY KEY (tenant_id, review_id)
);

CREATE INDEX review_entries_target_idx
  ON review_entries (tenant_id, target_type, target_id, created_at DESC);

CREATE TABLE approvals_next (
  tenant_id    TEXT NOT NULL,
  approval_id  TEXT NOT NULL,
  approval_key TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (
    kind IN (
      'workflow_step',
      'policy',
      'budget',
      'takeover',
      'intent',
      'retry',
      'connector.send'
    )
  ),
  status       TEXT NOT NULL CHECK (
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
  prompt       TEXT NOT NULL,
  motivation   TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT,
  latest_review_id TEXT,
  session_id   TEXT,
  plan_id      TEXT,
  run_id       TEXT,
  step_id      TEXT,
  attempt_id   TEXT,
  work_item_id TEXT,
  work_item_task_id TEXT,
  resume_token TEXT,
  PRIMARY KEY (tenant_id, approval_id),
  UNIQUE (tenant_id, approval_key),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, plan_id) REFERENCES plans(tenant_id, plan_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, run_id) REFERENCES execution_runs(tenant_id, run_id),
  FOREIGN KEY (tenant_id, step_id) REFERENCES execution_steps(tenant_id, step_id),
  FOREIGN KEY (tenant_id, attempt_id) REFERENCES execution_attempts(tenant_id, attempt_id),
  FOREIGN KEY (tenant_id, latest_review_id)
    REFERENCES review_entries(tenant_id, review_id) ON DELETE SET NULL
);

INSERT INTO approvals_next (
  tenant_id,
  approval_id,
  approval_key,
  agent_id,
  workspace_id,
  kind,
  status,
  prompt,
  motivation,
  context_json,
  created_at,
  expires_at,
  latest_review_id,
  session_id,
  plan_id,
  run_id,
  step_id,
  attempt_id,
  work_item_id,
  work_item_task_id,
  resume_token
)
SELECT
  tenant_id,
  approval_id,
  approval_key,
  agent_id,
  workspace_id,
  CASE
    WHEN kind IN (
      'workflow_step',
      'policy',
      'budget',
      'takeover',
      'intent',
      'retry',
      'connector.send'
    ) THEN kind
    ELSE 'policy'
  END AS kind,
  CASE
    WHEN status = 'pending' THEN 'awaiting_human'
    WHEN status IN ('approved', 'denied', 'expired', 'cancelled') THEN status
    ELSE 'awaiting_human'
  END AS status,
  prompt,
  COALESCE(
    CASE
      WHEN json_valid(context_json) THEN NULLIF(TRIM(CAST(json_extract(context_json, '$.paused_detail') AS TEXT)), '')
      ELSE NULL
    END,
    prompt
  ) AS motivation,
  context_json,
  created_at,
  expires_at,
  NULL AS latest_review_id,
  session_id,
  plan_id,
  CASE
    WHEN run_id IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1
      FROM execution_runs
      WHERE execution_runs.tenant_id = approvals.tenant_id
        AND execution_runs.run_id = approvals.run_id
    ) THEN run_id
    ELSE NULL
  END AS run_id,
  CASE
    WHEN step_id IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1
      FROM execution_steps
      WHERE execution_steps.tenant_id = approvals.tenant_id
        AND execution_steps.step_id = approvals.step_id
    ) THEN step_id
    ELSE NULL
  END AS step_id,
  CASE
    WHEN attempt_id IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1
      FROM execution_attempts
      WHERE execution_attempts.tenant_id = approvals.tenant_id
        AND execution_attempts.attempt_id = approvals.attempt_id
    ) THEN attempt_id
    ELSE NULL
  END AS attempt_id,
  work_item_id,
  work_item_task_id,
  resume_token
FROM approvals;

DROP TABLE approvals;
ALTER TABLE approvals_next RENAME TO approvals;

CREATE INDEX approvals_status_idx ON approvals (tenant_id, status);
CREATE INDEX approvals_expires_at_idx ON approvals (tenant_id, expires_at);
CREATE INDEX approvals_session_id_idx ON approvals (tenant_id, session_id);
CREATE INDEX approvals_plan_id_idx ON approvals (tenant_id, plan_id);

CREATE TABLE node_pairings_next (
  pairing_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (
    status IN ('queued', 'reviewing', 'awaiting_human', 'approved', 'denied', 'revoked')
  ),
  node_id        TEXT NOT NULL,
  pubkey         TEXT,
  label          TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  metadata_json  TEXT NOT NULL DEFAULT '{}',
  motivation     TEXT NOT NULL,
  latest_review_id TEXT,
  requested_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  trust_level    TEXT NOT NULL DEFAULT 'remote' CHECK (trust_level IN ('local','remote')),
  capability_allowlist_json TEXT NOT NULL DEFAULT '[]',
  scoped_token_sha256 TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, latest_review_id)
    REFERENCES review_entries(tenant_id, review_id) ON DELETE SET NULL,
  UNIQUE (tenant_id, node_id)
);

INSERT INTO node_pairings_next (
  pairing_id,
  tenant_id,
  status,
  node_id,
  pubkey,
  label,
  capabilities_json,
  metadata_json,
  motivation,
  latest_review_id,
  requested_at,
  last_seen_at,
  updated_at,
  trust_level,
  capability_allowlist_json,
  scoped_token_sha256
)
SELECT
  pairing_id,
  tenant_id,
  CASE
    WHEN status = 'pending' THEN 'awaiting_human'
    WHEN status IN ('approved', 'denied', 'revoked') THEN status
    ELSE 'awaiting_human'
  END AS status,
  node_id,
  pubkey,
  label,
  capabilities_json,
  metadata_json,
  COALESCE(
    NULLIF(TRIM(resolution_reason), ''),
    'Node requested pairing; evaluate trust level and allowed capabilities before enabling node actions.'
  ) AS motivation,
  NULL AS latest_review_id,
  requested_at,
  last_seen_at,
  updated_at,
  trust_level,
  capability_allowlist_json,
  scoped_token_sha256
FROM node_pairings;

DROP TABLE node_pairings;
ALTER TABLE node_pairings_next RENAME TO node_pairings;

CREATE INDEX node_pairings_status_idx ON node_pairings (tenant_id, status);
CREATE INDEX node_pairings_last_seen_at_idx ON node_pairings (tenant_id, last_seen_at);
