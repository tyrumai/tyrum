-- Add shared-state storage for agent identity, runtime packages, markdown memory,
-- lifecycle hooks, and authored policy bundles.

CREATE TABLE agent_identity_revisions (
  revision BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  agent_id UUID NOT NULL,
  identity_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  reverted_from_revision BIGINT,
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

CREATE TABLE runtime_package_revisions (
  revision BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  package_kind TEXT NOT NULL CHECK (package_kind IN ('skill', 'mcp', 'plugin')),
  package_key TEXT NOT NULL,
  package_json TEXT NOT NULL,
  artifact_id TEXT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  reverted_from_revision BIGINT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE agent_markdown_memory_docs (
  tenant_id UUID NOT NULL,
  agent_id UUID NOT NULL,
  doc_kind TEXT NOT NULL CHECK (doc_kind IN ('core', 'daily')),
  doc_key TEXT NOT NULL,
  content_md TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, agent_id, doc_kind, doc_key),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);

CREATE TABLE lifecycle_hook_configs (
  revision BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  hooks_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  reverted_from_revision BIGINT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE policy_bundle_config_revisions (
  revision BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('deployment', 'agent')),
  agent_id UUID NULL,
  bundle_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  reverted_from_revision BIGINT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, agent_id) ON DELETE CASCADE
);
