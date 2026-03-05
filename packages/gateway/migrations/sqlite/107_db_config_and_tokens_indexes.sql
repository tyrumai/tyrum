-- Indexes for DB-backed config/tokens.

CREATE INDEX IF NOT EXISTS tenants_status_idx ON tenants (status);
CREATE INDEX IF NOT EXISTS tenants_tenant_key_idx ON tenants (tenant_key);

CREATE INDEX IF NOT EXISTS auth_tokens_tenant_role_idx ON auth_tokens (tenant_id, role);
CREATE INDEX IF NOT EXISTS auth_tokens_revoked_at_idx ON auth_tokens (tenant_id, revoked_at);
CREATE INDEX IF NOT EXISTS auth_tokens_expires_at_idx ON auth_tokens (tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS auth_tokens_device_id_idx ON auth_tokens (tenant_id, device_id);

CREATE INDEX IF NOT EXISTS deployment_configs_revision_idx ON deployment_configs (revision DESC);
CREATE INDEX IF NOT EXISTS deployment_configs_created_at_idx ON deployment_configs (created_at DESC);

CREATE INDEX IF NOT EXISTS tenant_configs_revision_idx
ON tenant_configs (tenant_id, revision DESC);

CREATE INDEX IF NOT EXISTS agent_configs_revision_idx
ON agent_configs (tenant_id, agent_id, revision DESC);

CREATE INDEX IF NOT EXISTS oauth_provider_configs_tenant_provider_idx
ON oauth_provider_configs (tenant_id, provider_id);

CREATE INDEX IF NOT EXISTS catalog_provider_overrides_tenant_provider_idx
ON catalog_provider_overrides (tenant_id, provider_id);

CREATE INDEX IF NOT EXISTS catalog_model_overrides_tenant_provider_idx
ON catalog_model_overrides (tenant_id, provider_id);

CREATE INDEX IF NOT EXISTS migration_state_updated_at_idx
ON migration_state (updated_at DESC);
