-- Add explicit updated_at tracking for tables that mutate without another
-- authoritative change clock.

ALTER TABLE channel_accounts ADD COLUMN updated_at TEXT;

UPDATE channel_accounts
SET updated_at = created_at
WHERE updated_at IS NULL;

CREATE TRIGGER IF NOT EXISTS channel_accounts_set_updated_at_insert
AFTER INSERT ON channel_accounts
FOR EACH ROW
WHEN NEW.updated_at IS NULL
BEGIN
  UPDATE channel_accounts
  SET updated_at = COALESCE(NEW.created_at, datetime('now'))
  WHERE tenant_id = NEW.tenant_id
    AND workspace_id = NEW.workspace_id
    AND channel_account_id = NEW.channel_account_id;
END;

ALTER TABLE work_signals ADD COLUMN updated_at TEXT;

UPDATE work_signals
SET updated_at = created_at
WHERE updated_at IS NULL;

CREATE TRIGGER IF NOT EXISTS work_signals_set_updated_at_insert
AFTER INSERT ON work_signals
FOR EACH ROW
WHEN NEW.updated_at IS NULL
BEGIN
  UPDATE work_signals
  SET updated_at = COALESCE(NEW.created_at, datetime('now'))
  WHERE tenant_id = NEW.tenant_id
    AND signal_id = NEW.signal_id;
END;
