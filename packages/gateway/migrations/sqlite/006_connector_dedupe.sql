CREATE TABLE IF NOT EXISTS inbound_dedupe (
  message_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inbound_dedupe_expires ON inbound_dedupe(expires_at);

CREATE TABLE IF NOT EXISTS outbound_idempotency (
  idempotency_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  result_json TEXT,
  PRIMARY KEY (idempotency_key, channel)
);
