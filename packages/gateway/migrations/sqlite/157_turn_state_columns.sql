ALTER TABLE turns ADD COLUMN lease_owner TEXT;
ALTER TABLE turns ADD COLUMN lease_expires_at_ms INTEGER;
ALTER TABLE turns ADD COLUMN checkpoint_json TEXT;
ALTER TABLE turns ADD COLUMN last_progress_at TEXT;
ALTER TABLE turns ADD COLUMN last_progress_json TEXT;

CREATE INDEX IF NOT EXISTS turns_lease_expires_at_ms_idx
ON turns (tenant_id, lease_expires_at_ms);
