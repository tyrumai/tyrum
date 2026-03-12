CREATE UNIQUE INDEX IF NOT EXISTS channel_configs_telegram_webhook_secret_uq
ON channel_configs (
  tenant_id,
  BTRIM(config_json::jsonb ->> 'webhook_secret')
)
WHERE connector_key = 'telegram'
  AND COALESCE(BTRIM(config_json::jsonb ->> 'webhook_secret'), '') <> '';
