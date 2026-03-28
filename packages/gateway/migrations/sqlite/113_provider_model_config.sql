-- Add provider-oriented account metadata and configured model presets/assignments.

ALTER TABLE auth_profiles ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE auth_profiles ADD COLUMN method_key TEXT NOT NULL DEFAULT '';
ALTER TABLE auth_profiles ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json));

UPDATE auth_profiles
SET display_name = auth_profile_key
WHERE display_name = '' OR display_name IS NULL;

UPDATE auth_profiles
SET method_key = type
WHERE method_key = '' OR method_key IS NULL;

UPDATE auth_profiles
SET config_json = '{}'
WHERE config_json = '' OR config_json IS NULL;

ALTER TABLE conversation_model_overrides ADD COLUMN preset_key TEXT NULL;

CREATE TABLE configured_model_presets (
  tenant_id     TEXT NOT NULL,
  preset_id     TEXT NOT NULL,
  preset_key    TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  provider_key  TEXT NOT NULL,
  model_id      TEXT NOT NULL,
  options_json  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(options_json)),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, preset_id),
  UNIQUE (tenant_id, preset_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE execution_profile_model_assignments (
  tenant_id             TEXT NOT NULL,
  execution_profile_id  TEXT NOT NULL CHECK (
    execution_profile_id IN (
      'interaction',
      'explorer_ro',
      'reviewer_ro',
      'planner',
      'jury',
      'executor_rw',
      'integrator'
    )
  ),
  preset_key            TEXT NOT NULL,
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, execution_profile_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, preset_key)
    REFERENCES configured_model_presets(tenant_id, preset_key) ON DELETE RESTRICT
);

INSERT OR IGNORE INTO configured_model_presets (
  tenant_id,
  preset_id,
  preset_key,
  display_name,
  provider_key,
  model_id,
  options_json
)
SELECT tenant_id, '00000000-0000-4000-8000-000000001001', 'legacy-openai-gpt-4-1-medium',
       'Legacy OpenAI GPT-4.1 (medium)', 'openai', 'gpt-4.1', '{"reasoning_effort":"medium"}'
FROM tenants;

INSERT OR IGNORE INTO configured_model_presets (
  tenant_id,
  preset_id,
  preset_key,
  display_name,
  provider_key,
  model_id,
  options_json
)
SELECT tenant_id, '00000000-0000-4000-8000-000000001002', 'legacy-openai-gpt-4-1-mini-low',
       'Legacy OpenAI GPT-4.1 Mini (low)', 'openai', 'gpt-4.1-mini', '{"reasoning_effort":"low"}'
FROM tenants;

INSERT OR IGNORE INTO configured_model_presets (
  tenant_id,
  preset_id,
  preset_key,
  display_name,
  provider_key,
  model_id,
  options_json
)
SELECT tenant_id, '00000000-0000-4000-8000-000000001003', 'legacy-openai-gpt-4-1-mini-medium',
       'Legacy OpenAI GPT-4.1 Mini (medium)', 'openai', 'gpt-4.1-mini', '{"reasoning_effort":"medium"}'
FROM tenants;

INSERT OR IGNORE INTO configured_model_presets (
  tenant_id,
  preset_id,
  preset_key,
  display_name,
  provider_key,
  model_id,
  options_json
)
SELECT tenant_id, '00000000-0000-4000-8000-000000001004', 'legacy-openai-gpt-4-1-mini-high',
       'Legacy OpenAI GPT-4.1 Mini (high)', 'openai', 'gpt-4.1-mini', '{"reasoning_effort":"high"}'
FROM tenants;

INSERT OR IGNORE INTO configured_model_presets (
  tenant_id,
  preset_id,
  preset_key,
  display_name,
  provider_key,
  model_id,
  options_json
)
SELECT tenant_id, '00000000-0000-4000-8000-000000001005', 'legacy-openai-gpt-4-1-high',
       'Legacy OpenAI GPT-4.1 (high)', 'openai', 'gpt-4.1', '{"reasoning_effort":"high"}'
FROM tenants;

INSERT OR IGNORE INTO execution_profile_model_assignments (tenant_id, execution_profile_id, preset_key)
SELECT tenant_id, 'interaction', 'legacy-openai-gpt-4-1-medium' FROM tenants;

INSERT OR IGNORE INTO execution_profile_model_assignments (tenant_id, execution_profile_id, preset_key)
SELECT tenant_id, 'explorer_ro', 'legacy-openai-gpt-4-1-mini-low' FROM tenants;

INSERT OR IGNORE INTO execution_profile_model_assignments (tenant_id, execution_profile_id, preset_key)
SELECT tenant_id, 'reviewer_ro', 'legacy-openai-gpt-4-1-mini-low' FROM tenants;

INSERT OR IGNORE INTO execution_profile_model_assignments (tenant_id, execution_profile_id, preset_key)
SELECT tenant_id, 'planner', 'legacy-openai-gpt-4-1-mini-high' FROM tenants;

INSERT OR IGNORE INTO execution_profile_model_assignments (tenant_id, execution_profile_id, preset_key)
SELECT tenant_id, 'jury', 'legacy-openai-gpt-4-1-mini-medium' FROM tenants;

INSERT OR IGNORE INTO execution_profile_model_assignments (tenant_id, execution_profile_id, preset_key)
SELECT tenant_id, 'executor_rw', 'legacy-openai-gpt-4-1-high' FROM tenants;

INSERT OR IGNORE INTO execution_profile_model_assignments (tenant_id, execution_profile_id, preset_key)
SELECT tenant_id, 'integrator', 'legacy-openai-gpt-4-1-high' FROM tenants;
