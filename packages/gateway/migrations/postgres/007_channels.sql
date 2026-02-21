-- Durable channel inbox/outbox for connector processing (Telegram first).

CREATE TABLE IF NOT EXISTS channel_inbox (
  inbox_id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  key TEXT NOT NULL,
  lane TEXT NOT NULL,
  received_at_ms BIGINT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at_ms BIGINT,
  processed_at TIMESTAMPTZ,
  error TEXT,
  reply_text TEXT,
  CONSTRAINT channel_inbox_dedupe UNIQUE (source, thread_id, message_id)
);

CREATE INDEX IF NOT EXISTS channel_inbox_status_idx ON channel_inbox (status);
CREATE INDEX IF NOT EXISTS channel_inbox_key_lane_idx ON channel_inbox (key, lane);
CREATE INDEX IF NOT EXISTS channel_inbox_received_at_ms_idx ON channel_inbox (received_at_ms);
CREATE INDEX IF NOT EXISTS channel_inbox_lease_expires_at_ms_idx ON channel_inbox (lease_expires_at_ms);

CREATE TABLE IF NOT EXISTS channel_outbox (
  outbox_id BIGSERIAL PRIMARY KEY,
  inbox_id BIGINT NOT NULL,
  source TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  parse_mode TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  error TEXT,
  response_json TEXT,
  CONSTRAINT channel_outbox_inbox_fk FOREIGN KEY (inbox_id) REFERENCES channel_inbox(inbox_id),
  CONSTRAINT channel_outbox_dedupe UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS channel_outbox_status_idx ON channel_outbox (status);
CREATE INDEX IF NOT EXISTS channel_outbox_inbox_id_idx ON channel_outbox (inbox_id);
CREATE INDEX IF NOT EXISTS channel_outbox_created_at_idx ON channel_outbox (created_at);
CREATE INDEX IF NOT EXISTS channel_outbox_lease_expires_at_ms_idx ON channel_outbox (lease_expires_at_ms);

