-- Intake mode overrides — operator-controlled deterministic delegation
CREATE TABLE IF NOT EXISTS intake_mode_overrides (
  key TEXT NOT NULL,
  lane TEXT NOT NULL,
  intake_mode TEXT NOT NULL CHECK (intake_mode IN ('inline', 'delegate_execute', 'delegate_plan')),
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (key, lane)
);

CREATE INDEX IF NOT EXISTS intake_mode_overrides_updated_at_ms_idx
ON intake_mode_overrides (updated_at_ms DESC);
