CREATE INDEX IF NOT EXISTS configured_model_presets_tenant_provider_idx
ON configured_model_presets (tenant_id, provider_key);

CREATE INDEX IF NOT EXISTS configured_model_presets_tenant_model_idx
ON configured_model_presets (tenant_id, provider_key, model_id);

CREATE INDEX IF NOT EXISTS execution_profile_model_assignments_tenant_preset_idx
ON execution_profile_model_assignments (tenant_id, preset_key);

CREATE INDEX IF NOT EXISTS conversation_model_overrides_tenant_preset_key_idx
ON conversation_model_overrides (tenant_id, preset_key);
