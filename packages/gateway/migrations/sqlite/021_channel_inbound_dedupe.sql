-- Inbound dedupe keys with TTL (cluster-safe).
--
-- Architecture: docs/architecture/messages-sessions.md
-- Keyed by stable identifiers: (channel, account_id, container_id, message_id)
-- Entries expire by expires_at_ms and are pruned opportunistically.

CREATE TABLE IF NOT EXISTS channel_inbound_dedupe (
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL,
  container_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  inbox_id INTEGER,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (channel, account_id, container_id, message_id)
);

CREATE INDEX IF NOT EXISTS channel_inbound_dedupe_expires_at_ms_idx ON channel_inbound_dedupe (expires_at_ms);

-- channel_inbox previously enforced permanent dedupe via UNIQUE(source, thread_id, message_id).
-- Remove the constraint so inbound dedupe can be TTL-bounded via channel_inbound_dedupe.
ALTER TABLE channel_outbox RENAME TO channel_outbox_old;
ALTER TABLE channel_inbox RENAME TO channel_inbox_old;

CREATE TABLE channel_inbox (
  inbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  key TEXT NOT NULL,
  lane TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  processed_at TEXT,
  error TEXT,
  reply_text TEXT
);

CREATE TABLE channel_outbox (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  inbox_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  parse_mode TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  error TEXT,
  response_json TEXT,
  approval_id INTEGER,
  FOREIGN KEY (inbox_id) REFERENCES channel_inbox(inbox_id),
  UNIQUE (dedupe_key)
);

INSERT INTO channel_inbox (
  inbox_id,
  source,
  thread_id,
  message_id,
  key,
  lane,
  received_at_ms,
  payload_json,
  status,
  attempt,
  lease_owner,
  lease_expires_at_ms,
  processed_at,
  error,
  reply_text
)
SELECT
  inbox_id,
  source,
  thread_id,
  message_id,
  key,
  lane,
  received_at_ms,
  payload_json,
  status,
  attempt,
  lease_owner,
  lease_expires_at_ms,
  processed_at,
  error,
  reply_text
FROM channel_inbox_old;

INSERT INTO channel_outbox (
  outbox_id,
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
  approval_id
)
SELECT
  outbox_id,
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
  approval_id
FROM channel_outbox_old;

DROP TABLE channel_outbox_old;
DROP TABLE channel_inbox_old;

CREATE INDEX IF NOT EXISTS channel_inbox_status_idx ON channel_inbox (status);
CREATE INDEX IF NOT EXISTS channel_inbox_key_lane_idx ON channel_inbox (key, lane);
CREATE INDEX IF NOT EXISTS channel_inbox_received_at_ms_idx ON channel_inbox (received_at_ms);
CREATE INDEX IF NOT EXISTS channel_inbox_lease_expires_at_ms_idx ON channel_inbox (lease_expires_at_ms);
CREATE INDEX IF NOT EXISTS channel_inbox_dedupe_lookup_idx ON channel_inbox (source, thread_id, message_id);

CREATE INDEX IF NOT EXISTS channel_outbox_status_idx ON channel_outbox (status);
CREATE INDEX IF NOT EXISTS channel_outbox_inbox_id_idx ON channel_outbox (inbox_id);
CREATE INDEX IF NOT EXISTS channel_outbox_created_at_idx ON channel_outbox (created_at);
CREATE INDEX IF NOT EXISTS channel_outbox_lease_expires_at_ms_idx ON channel_outbox (lease_expires_at_ms);
CREATE INDEX IF NOT EXISTS channel_outbox_approval_id_idx ON channel_outbox (approval_id);
