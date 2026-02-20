CREATE TABLE IF NOT EXISTS outbox (
  id BIGSERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  target_edge_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbox_topic_idx ON outbox (topic);
CREATE INDEX IF NOT EXISTS outbox_target_edge_idx ON outbox (target_edge_id);

CREATE TABLE IF NOT EXISTS outbox_consumers (
  consumer_id TEXT PRIMARY KEY,
  last_outbox_id BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

