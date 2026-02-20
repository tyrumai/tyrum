CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  target_edge_id TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS outbox_topic_idx ON outbox (topic);
CREATE INDEX IF NOT EXISTS outbox_target_edge_idx ON outbox (target_edge_id);

CREATE TABLE IF NOT EXISTS outbox_consumers (
  consumer_id TEXT PRIMARY KEY,
  last_outbox_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

