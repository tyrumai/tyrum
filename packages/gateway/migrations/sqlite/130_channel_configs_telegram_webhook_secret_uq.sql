CREATE UNIQUE INDEX IF NOT EXISTS channel_configs_telegram_webhook_secret_uq
ON channel_configs (
  tenant_id,
  trim(CAST(json_extract(config_json, '$.webhook_secret') AS TEXT))
)
WHERE connector_key = 'telegram'
  AND COALESCE(trim(CAST(json_extract(config_json, '$.webhook_secret') AS TEXT)), '') <> '';
