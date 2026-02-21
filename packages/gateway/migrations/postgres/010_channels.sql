-- 025_channels.sql
--
-- Channel ingress/egress coordination primitives:
-- - durable inbound dedupe + debounce buffering
-- - outbound send queue with approval integration and receipts

CREATE TABLE IF NOT EXISTS channel_inbound_messages (
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL,
  container_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  thread_kind TEXT NOT NULL,
  sender_id TEXT,
  sender_is_bot BOOLEAN NOT NULL DEFAULT FALSE,
  provenance_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  text TEXT,
  has_attachment BOOLEAN NOT NULL DEFAULT FALSE,
  received_at_ms BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dropped')),
  processing_owner TEXT,
  processing_expires_at_ms BIGINT,
  processed_at_ms BIGINT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, account_id, container_id, message_id)
);

CREATE INDEX IF NOT EXISTS channel_inbound_messages_status_idx ON channel_inbound_messages (status);
CREATE INDEX IF NOT EXISTS channel_inbound_messages_container_idx ON channel_inbound_messages (channel, account_id, container_id, status, received_at_ms);
CREATE INDEX IF NOT EXISTS channel_inbound_messages_processing_idx ON channel_inbound_messages (processing_expires_at_ms);

CREATE TABLE IF NOT EXISTS channel_outbound_sends (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL,
  container_id TEXT NOT NULL,
  reply_to_message_id TEXT,
  body TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'awaiting_approval', 'sent', 'failed', 'denied')),
  approval_id INTEGER,
  send_attempt INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  receipt_json JSONB,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  UNIQUE (channel, account_id, container_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS channel_outbound_sends_status_idx
  ON channel_outbound_sends (status, updated_at_ms);
CREATE INDEX IF NOT EXISTS channel_outbound_sends_approval_idx
  ON channel_outbound_sends (approval_id);

