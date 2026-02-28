-- Inbound dedupe keys with TTL (cluster-safe).
--
-- Architecture: docs/architecture/messages-sessions.md
-- Keyed by stable identifiers: (channel, account_id, container_id, message_id)

CREATE TABLE IF NOT EXISTS channel_inbound_dedupe (
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL,
  container_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  inbox_id BIGINT,
  expires_at_ms BIGINT NOT NULL,
  PRIMARY KEY (channel, account_id, container_id, message_id)
);

CREATE INDEX IF NOT EXISTS channel_inbound_dedupe_expires_at_ms_idx ON channel_inbound_dedupe (expires_at_ms);

-- channel_inbox previously enforced permanent dedupe via UNIQUE(source, thread_id, message_id).
-- Remove the constraint so inbound dedupe can be TTL-bounded via channel_inbound_dedupe.
ALTER TABLE channel_inbox DROP CONSTRAINT IF EXISTS channel_inbox_dedupe;

CREATE INDEX IF NOT EXISTS channel_inbox_dedupe_lookup_idx ON channel_inbox (source, thread_id, message_id);

