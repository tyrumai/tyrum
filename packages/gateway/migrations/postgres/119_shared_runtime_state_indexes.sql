CREATE INDEX idx_agent_identity_revisions_lookup
  ON agent_identity_revisions (tenant_id, agent_id, revision);

CREATE INDEX idx_runtime_package_revisions_lookup
  ON runtime_package_revisions (tenant_id, package_kind, package_key, revision);

CREATE INDEX idx_runtime_package_revisions_kind_enabled
  ON runtime_package_revisions (tenant_id, package_kind, enabled, revision);

CREATE INDEX idx_agent_markdown_memory_docs_updated
  ON agent_markdown_memory_docs (tenant_id, agent_id, updated_at);

CREATE INDEX idx_lifecycle_hook_configs_lookup
  ON lifecycle_hook_configs (tenant_id, revision);

CREATE INDEX idx_policy_bundle_config_revisions_lookup
  ON policy_bundle_config_revisions (tenant_id, scope_kind, agent_id, revision);
