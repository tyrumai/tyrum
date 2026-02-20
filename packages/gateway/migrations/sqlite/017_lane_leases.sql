CREATE TABLE IF NOT EXISTS lane_leases (
  key TEXT NOT NULL,
  lane TEXT NOT NULL,
  lease_owner TEXT NOT NULL,
  lease_expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (key, lane)
);

CREATE INDEX IF NOT EXISTS lane_leases_expires_at_idx ON lane_leases (lease_expires_at_ms);

