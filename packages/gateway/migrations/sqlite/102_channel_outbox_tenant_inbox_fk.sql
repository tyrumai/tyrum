-- Enforce tenant-scoped FK for channel_outbox → channel_inbox.

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
  session_id         TEXT NOT NULL,
  channel_thread_id  TEXT NOT NULL,
  UNIQUE (tenant_id, dedupe_key),
  FOREIGN KEY (tenant_id, inbox_id) REFERENCES channel_inbox(tenant_id, inbox_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, session_id) ON DELETE CASCADE
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
  session_id,
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
  approval_id,
  workspace_id,
  session_id,
  channel_thread_id
FROM channel_outbox__old;

DROP TABLE channel_outbox__old;

-- Re-create channel_outbox indexes that were dropped with the table rebuild.
CREATE INDEX IF NOT EXISTS channel_outbox_status_idx
ON channel_outbox (tenant_id, status);
CREATE INDEX IF NOT EXISTS channel_outbox_created_at_idx
ON channel_outbox (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS channel_outbox_lease_expires_at_ms_idx
ON channel_outbox (tenant_id, lease_expires_at_ms);
CREATE INDEX IF NOT EXISTS channel_outbox_approval_id_idx
ON channel_outbox (tenant_id, approval_id);
CREATE INDEX IF NOT EXISTS channel_outbox_session_id_idx
ON channel_outbox (tenant_id, session_id);

