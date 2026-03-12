CREATE TABLE channel_configs (
  tenant_id UUID NOT NULL,
  connector_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  config_json TEXT NOT NULL CHECK (pg_input_is_valid(config_json, 'jsonb')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, connector_key, account_key),
  CONSTRAINT channel_configs_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);
