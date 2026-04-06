-- tyrum:disable_foreign_keys
--
-- Enforce the audited approval/policy foreign keys while preserving rolling-upgrade
-- safety by normalizing legacy orphaned references to NULL during the rebuild.
--
-- Delete-time cleanup remains explicit. These tenant-scoped composite keys
-- cannot null only the ID column on parent deletion without also nulling the
-- NOT NULL tenant_id column.

CREATE TABLE approvals_next (
  tenant_id    TEXT NOT NULL,
  approval_id  TEXT NOT NULL,
  approval_key TEXT NOT NULL,
  agent_id     TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (
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
  status       TEXT NOT NULL CHECK (status IN ('pending','approved','denied','expired','cancelled')),
  prompt       TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT,
  resolved_at  TEXT,
  resolution_json TEXT,
  conversation_id   TEXT,
  plan_id      TEXT,
  turn_id      TEXT,
  step_id      TEXT,
  attempt_id   TEXT,
  work_item_id TEXT,
  work_item_task_id TEXT,
  resume_token TEXT,
  PRIMARY KEY (tenant_id, approval_id),
  UNIQUE (tenant_id, approval_key),
  FOREIGN KEY (tenant_id, agent_id, workspace_id)
    REFERENCES agent_workspaces(tenant_id, agent_id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, conversation_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, plan_id) REFERENCES plans(tenant_id, plan_id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, turn_id) REFERENCES turns(tenant_id, turn_id)
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
  context_json,
  created_at,
  expires_at,
  resolved_at,
  resolution_json,
  conversation_id,
  plan_id,
  turn_id,
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
  kind,
  status,
  prompt,
  context_json,
  created_at,
  expires_at,
  resolved_at,
  resolution_json,
  conversation_id,
  plan_id,
  CASE
    WHEN turn_id IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1
      FROM turns
      WHERE turns.tenant_id = approvals.tenant_id
        AND turns.turn_id = approvals.turn_id
    ) THEN turn_id
    ELSE NULL
  END AS turn_id,
  step_id,
  attempt_id,
  work_item_id,
  work_item_task_id,
  resume_token
FROM approvals;

DROP TABLE approvals;
ALTER TABLE approvals_next RENAME TO approvals;

CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals (tenant_id, status);
CREATE INDEX IF NOT EXISTS approvals_expires_at_idx ON approvals (tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS approvals_conversation_id_idx ON approvals (tenant_id, conversation_id);
CREATE INDEX IF NOT EXISTS approvals_plan_id_idx ON approvals (tenant_id, plan_id);

CREATE TABLE policy_overrides_next (
  tenant_id          TEXT NOT NULL,
  policy_override_id TEXT NOT NULL,
  override_key       TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('active','revoked','expired')),
  agent_id           TEXT NOT NULL,
  workspace_id       TEXT,
  tool_id            TEXT NOT NULL,
  pattern            TEXT NOT NULL,
  created_from_approval_id TEXT,
  created_from_policy_snapshot_id TEXT,
  created_by_json    TEXT NOT NULL DEFAULT '{}',
  expires_at         TEXT,
  revoked_at         TEXT,
  revoked_by_json    TEXT,
  revoked_reason     TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, policy_override_id),
  UNIQUE (tenant_id, override_key),
  FOREIGN KEY (tenant_id, created_from_approval_id)
    REFERENCES approvals(tenant_id, approval_id),
  FOREIGN KEY (tenant_id, created_from_policy_snapshot_id)
    REFERENCES policy_snapshots(tenant_id, policy_snapshot_id) ON DELETE SET NULL
);

INSERT INTO policy_overrides_next (
  tenant_id,
  policy_override_id,
  override_key,
  status,
  agent_id,
  workspace_id,
  tool_id,
  pattern,
  created_from_approval_id,
  created_from_policy_snapshot_id,
  created_by_json,
  expires_at,
  revoked_at,
  revoked_by_json,
  revoked_reason,
  created_at,
  updated_at
)
SELECT
  tenant_id,
  policy_override_id,
  override_key,
  status,
  agent_id,
  workspace_id,
  tool_id,
  pattern,
  CASE
    WHEN created_from_approval_id IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1
      FROM approvals
      WHERE approvals.tenant_id = policy_overrides.tenant_id
        AND approvals.approval_id = policy_overrides.created_from_approval_id
    ) THEN created_from_approval_id
    ELSE NULL
  END AS created_from_approval_id,
  created_from_policy_snapshot_id,
  created_by_json,
  expires_at,
  revoked_at,
  revoked_by_json,
  revoked_reason,
  created_at,
  updated_at
FROM policy_overrides;

DROP TABLE policy_overrides;
ALTER TABLE policy_overrides_next RENAME TO policy_overrides;

CREATE INDEX IF NOT EXISTS policy_overrides_status_idx ON policy_overrides (tenant_id, status);
CREATE INDEX IF NOT EXISTS policy_overrides_agent_tool_idx
ON policy_overrides (tenant_id, agent_id, tool_id);
CREATE INDEX IF NOT EXISTS policy_overrides_workspace_id_idx
ON policy_overrides (tenant_id, workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS channel_inbox_tenant_inbox_uq
ON channel_inbox (tenant_id, inbox_id);

ALTER TABLE channel_outbox RENAME TO channel_outbox__old;

CREATE TABLE channel_outbox (
  outbox_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id          TEXT NOT NULL,
  inbox_id           INTEGER NOT NULL,
  source             TEXT NOT NULL,
  thread_id          TEXT NOT NULL,
  dedupe_key         TEXT NOT NULL,
  chunk_index        INTEGER NOT NULL DEFAULT 0,
  text               TEXT NOT NULL,
  parse_mode         TEXT,
  status             TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  attempt            INTEGER NOT NULL DEFAULT 0,
  lease_owner        TEXT,
  lease_expires_at_ms INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at            TEXT,
  error              TEXT,
  response_json      TEXT,
  approval_id        TEXT,
  workspace_id       TEXT NOT NULL,
  conversation_id         TEXT NOT NULL,
  channel_thread_id  TEXT NOT NULL,
  UNIQUE (tenant_id, dedupe_key),
  FOREIGN KEY (tenant_id, inbox_id) REFERENCES channel_inbox(tenant_id, inbox_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, approval_id) REFERENCES approvals(tenant_id, approval_id)
);

INSERT INTO channel_outbox (
  outbox_id,
  tenant_id,
  inbox_id,
  source,
  thread_id,
  dedupe_key,
  chunk_index,
  text,
  parse_mode,
  status,
  attempt,
  lease_owner,
  lease_expires_at_ms,
  created_at,
  sent_at,
  error,
  response_json,
  approval_id,
  workspace_id,
  conversation_id,
  channel_thread_id
)
SELECT
  outbox_id,
  tenant_id,
  inbox_id,
  source,
  thread_id,
  dedupe_key,
  chunk_index,
  text,
  parse_mode,
  status,
  attempt,
  lease_owner,
  lease_expires_at_ms,
  created_at,
  sent_at,
  error,
  response_json,
  CASE
    WHEN approval_id IS NULL THEN NULL
    WHEN EXISTS (
      SELECT 1
      FROM approvals
      WHERE approvals.tenant_id = channel_outbox__old.tenant_id
        AND approvals.approval_id = channel_outbox__old.approval_id
    ) THEN approval_id
    ELSE NULL
  END AS approval_id,
  workspace_id,
  conversation_id,
  channel_thread_id
FROM channel_outbox__old;

DROP TABLE channel_outbox__old;

CREATE INDEX IF NOT EXISTS channel_outbox_status_idx
ON channel_outbox (tenant_id, status);
CREATE INDEX IF NOT EXISTS channel_outbox_created_at_idx
ON channel_outbox (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS channel_outbox_lease_expires_at_ms_idx
ON channel_outbox (tenant_id, lease_expires_at_ms);
CREATE INDEX IF NOT EXISTS channel_outbox_approval_id_idx
ON channel_outbox (tenant_id, approval_id);
CREATE INDEX IF NOT EXISTS channel_outbox_conversation_id_idx
ON channel_outbox (tenant_id, conversation_id);
CREATE INDEX IF NOT EXISTS channel_outbox_inbox_chunk_outbox_idx
ON channel_outbox (inbox_id, chunk_index, outbox_id);
