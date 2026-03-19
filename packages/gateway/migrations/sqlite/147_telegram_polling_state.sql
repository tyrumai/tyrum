DELETE FROM channel_configs
WHERE connector_key = '__legacy_import__'
  AND account_key = 'telegram';

CREATE TABLE IF NOT EXISTS telegram_polling_state (
  tenant_id TEXT NOT NULL,
  account_key TEXT NOT NULL,
  bot_user_id TEXT,
  next_update_id INTEGER,
  status TEXT NOT NULL DEFAULT 'idle',
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  last_polled_at TEXT,
  last_error_at TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (tenant_id, account_key)
);

CREATE INDEX IF NOT EXISTS telegram_polling_state_lease_expires_at_idx
ON telegram_polling_state (tenant_id, lease_expires_at_ms);
