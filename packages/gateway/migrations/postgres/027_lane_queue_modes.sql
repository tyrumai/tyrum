-- Lane-aware queue modes for inbound connector processing.

ALTER TABLE channel_inbox
ADD COLUMN queue_mode TEXT NOT NULL DEFAULT 'collect';

CREATE TABLE IF NOT EXISTS lane_queue_signals (
  key TEXT NOT NULL,
  lane TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('steer', 'interrupt')),
  inbox_id INTEGER,
  queue_mode TEXT NOT NULL,
  message_text TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  PRIMARY KEY (key, lane)
);

CREATE INDEX IF NOT EXISTS lane_queue_signals_kind_idx ON lane_queue_signals (kind);
CREATE INDEX IF NOT EXISTS lane_queue_signals_created_at_ms_idx ON lane_queue_signals (created_at_ms);

