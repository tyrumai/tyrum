ALTER TABLE turns ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS lease_expires_at_ms BIGINT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS checkpoint_json TEXT;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ;
ALTER TABLE turns ADD COLUMN IF NOT EXISTS last_progress_json TEXT;

CREATE INDEX IF NOT EXISTS turns_lease_expires_at_ms_idx
ON turns (tenant_id, lease_expires_at_ms);
