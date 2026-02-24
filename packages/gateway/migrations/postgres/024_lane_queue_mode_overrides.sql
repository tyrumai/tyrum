-- Per-lane queue mode overrides (slash command /queue).

CREATE TABLE IF NOT EXISTS lane_queue_mode_overrides (
  key TEXT NOT NULL,
  lane TEXT NOT NULL,
  queue_mode TEXT NOT NULL CHECK (queue_mode IN ('collect', 'followup', 'steer', 'steer_backlog', 'interrupt')),
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (key, lane)
);

CREATE INDEX IF NOT EXISTS lane_queue_mode_overrides_updated_at_ms_idx
ON lane_queue_mode_overrides (updated_at_ms DESC);

