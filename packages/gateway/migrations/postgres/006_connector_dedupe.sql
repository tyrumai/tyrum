CREATE TABLE IF NOT EXISTS inbound_dedupe (
  message_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inbound_dedupe_expires ON inbound_dedupe(expires_at);

CREATE TABLE IF NOT EXISTS outbound_idempotency (
  idempotency_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  result_json JSONB,
  PRIMARY KEY (idempotency_key, channel)
);
