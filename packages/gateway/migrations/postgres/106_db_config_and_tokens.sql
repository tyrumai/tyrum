-- Add DB-backed deployment config + tenant-scoped auth tokens + agent config revisions.

-- ---------------------------------------------------------------------------
-- Tenants metadata
-- ---------------------------------------------------------------------------

ALTER TABLE tenants ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants
ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
CHECK (status IN ('active', 'disabled'));

UPDATE tenants
SET name =
  CASE
    WHEN tenant_key = 'default' THEN 'Default'
    ELSE tenant_key
  END
WHERE name = '' OR name IS NULL;

-- ---------------------------------------------------------------------------
-- Auth tokens (tenant-scoped; optional system tokens have tenant_id NULL)
-- ---------------------------------------------------------------------------

CREATE TABLE auth_tokens (
  token_id         TEXT PRIMARY KEY,
  tenant_id        UUID NULL,
  role             TEXT NOT NULL CHECK (role IN ('admin','client','node')),
  device_id        TEXT NULL,
  scopes_json      TEXT NOT NULL,
  secret_salt      TEXT NOT NULL,
  secret_hash      TEXT NOT NULL,
  kdf              TEXT NOT NULL DEFAULT 'scrypt',
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NULL,
  revoked_at       TIMESTAMPTZ NULL,
  created_by_json  TEXT NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_tokens_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Deployment config revisions (global, not tenant-scoped)
-- ---------------------------------------------------------------------------

CREATE TABLE deployment_configs (
  revision BIGSERIAL PRIMARY KEY,
  config_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  reverted_from_revision BIGINT
);

-- ---------------------------------------------------------------------------
-- Tenant config revisions (tenant-scoped)
-- ---------------------------------------------------------------------------

CREATE TABLE tenant_configs (
  revision BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  config_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  reverted_from_revision BIGINT,
  CONSTRAINT tenant_configs_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Agent config revisions (tenant-scoped; agent_id is UUID from agents table)
-- ---------------------------------------------------------------------------

CREATE TABLE agent_configs (
  revision BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  agent_id UUID NOT NULL,
  config_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  reverted_from_revision BIGINT,
  CONSTRAINT agent_configs_agent_fk FOREIGN KEY (tenant_id, agent_id)
    REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- OAuth provider configuration (tenant-scoped, DB-backed)
-- ---------------------------------------------------------------------------

CREATE TABLE oauth_provider_configs (
  tenant_id UUID NOT NULL,
  provider_id TEXT NOT NULL,
  display_name TEXT NULL,
  issuer TEXT NULL,
  authorization_endpoint TEXT NULL,
  token_endpoint TEXT NULL,
  device_authorization_endpoint TEXT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  client_id TEXT NOT NULL,
  client_secret_key TEXT NULL,
  token_endpoint_basic_auth BOOLEAN NOT NULL DEFAULT FALSE,
  extra_authorize_params_json TEXT NOT NULL DEFAULT '{}',
  extra_token_params_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider_id),
  CONSTRAINT oauth_provider_configs_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Catalog overrides (tenant-scoped)
-- ---------------------------------------------------------------------------

CREATE TABLE catalog_provider_overrides (
  tenant_id UUID NOT NULL,
  provider_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  name TEXT NULL,
  npm TEXT NULL,
  api TEXT NULL,
  doc TEXT NULL,
  options_json TEXT NOT NULL DEFAULT '{}',
  headers_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider_id),
  CONSTRAINT catalog_provider_overrides_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE catalog_model_overrides (
  tenant_id UUID NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  name TEXT NULL,
  family TEXT NULL,
  release_date TEXT NULL,
  last_updated TEXT NULL,
  modalities_json TEXT NULL,
  limit_json TEXT NULL,
  provider_npm TEXT NULL,
  provider_api TEXT NULL,
  options_json TEXT NOT NULL DEFAULT '{}',
  headers_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider_id, model_id),
  CONSTRAINT catalog_model_overrides_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- One-time migration guard/state (optional)
-- ---------------------------------------------------------------------------

CREATE TABLE migration_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
