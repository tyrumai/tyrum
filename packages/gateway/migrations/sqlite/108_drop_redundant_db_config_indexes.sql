-- Remove redundant indexes already covered by table primary keys.

DROP INDEX IF EXISTS deployment_configs_revision_idx;
DROP INDEX IF EXISTS oauth_provider_configs_tenant_provider_idx;
DROP INDEX IF EXISTS catalog_provider_overrides_tenant_provider_idx;
DROP INDEX IF EXISTS catalog_model_overrides_tenant_provider_idx;
