-- Reduce default-tenant footguns for future multi-tenant safety.
--
-- Routing configs are tenant-scoped and should require explicit tenant_id.
ALTER TABLE routing_configs
  ALTER COLUMN tenant_id DROP DEFAULT;

-- Models.dev cache/leases are global-by-design (ModelsDevService is process-wide, not tenant-scoped).
-- Avoid implying tenant scoping by removing tenant_id + default-tenant association.
ALTER TABLE models_dev_cache
  DROP CONSTRAINT IF EXISTS models_dev_cache_tenant_fk;
ALTER TABLE models_dev_cache
  DROP COLUMN IF EXISTS tenant_id;

ALTER TABLE models_dev_refresh_leases
  DROP CONSTRAINT IF EXISTS models_dev_refresh_leases_tenant_fk;
ALTER TABLE models_dev_refresh_leases
  DROP COLUMN IF EXISTS tenant_id;
