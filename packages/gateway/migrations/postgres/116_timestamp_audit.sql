-- Add explicit updated_at tracking for tables that mutate without another
-- authoritative change clock.

ALTER TABLE channel_accounts ADD COLUMN updated_at TIMESTAMPTZ;

UPDATE channel_accounts
SET updated_at = created_at
WHERE updated_at IS NULL;

ALTER TABLE channel_accounts ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE channel_accounts ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE work_signals ADD COLUMN updated_at TIMESTAMPTZ;

UPDATE work_signals
SET updated_at = created_at
WHERE updated_at IS NULL;

ALTER TABLE work_signals ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE work_signals ALTER COLUMN updated_at SET NOT NULL;
