CREATE TABLE IF NOT EXISTS workspace_leases (
  workspace_id TEXT PRIMARY KEY,
  lease_owner TEXT NOT NULL,
  lease_expires_at_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS workspace_leases_expires_at_idx ON workspace_leases (lease_expires_at_ms);

