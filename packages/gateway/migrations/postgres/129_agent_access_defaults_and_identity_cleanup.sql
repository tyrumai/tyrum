UPDATE agent_configs
SET config_json = jsonb_set(
  config_json::jsonb,
  '{persona}',
  (config_json::jsonb -> 'persona') - 'description',
  true
)::text
WHERE jsonb_typeof(config_json::jsonb -> 'persona') = 'object'
  AND (config_json::jsonb -> 'persona' -> 'description') IS NOT NULL;

UPDATE agent_configs
SET config_json = jsonb_set(
  config_json::jsonb - 'skills',
  '{skills}',
  jsonb_build_object(
    'default_mode',
    'deny',
    'allow',
    COALESCE(config_json::jsonb -> 'skills' -> 'enabled', '[]'::jsonb),
    'deny',
    '[]'::jsonb,
    'workspace_trusted',
    COALESCE(config_json::jsonb -> 'skills' -> 'workspace_trusted', 'false'::jsonb)
  ),
  true
)::text
WHERE jsonb_typeof(config_json::jsonb -> 'skills' -> 'enabled') = 'array'
  AND (config_json::jsonb -> 'skills' -> 'default_mode') IS NULL;

UPDATE agent_configs
SET config_json = jsonb_set(
  config_json::jsonb - 'mcp',
  '{mcp}',
  jsonb_build_object(
    'default_mode',
    'deny',
    'allow',
    COALESCE(config_json::jsonb -> 'mcp' -> 'enabled', '[]'::jsonb),
    'deny',
    '[]'::jsonb
  ),
  true
)::text
WHERE jsonb_typeof(config_json::jsonb -> 'mcp' -> 'enabled') = 'array'
  AND (config_json::jsonb -> 'mcp' -> 'default_mode') IS NULL;

UPDATE agent_configs
SET config_json = jsonb_set(
  config_json::jsonb - 'tools',
  '{tools}',
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(COALESCE(config_json::jsonb -> 'tools' -> 'allow', '[]'::jsonb)) AS tool(id)
      WHERE btrim(tool.id) IN ('*', 'tool.*')
    ) THEN jsonb_build_object(
      'default_mode',
      'allow',
      'allow',
      '[]'::jsonb,
      'deny',
      '[]'::jsonb
    )
    WHEN EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(COALESCE(config_json::jsonb -> 'tools' -> 'allow', '[]'::jsonb)) AS tool(id)
      WHERE btrim(tool.id) = 'tool.fs.*'
    ) THEN jsonb_build_object(
      'default_mode',
      'deny',
      'allow',
      '["read","write","edit","apply_patch","glob","grep"]'::jsonb,
      'deny',
      '[]'::jsonb
    )
    ELSE jsonb_build_object(
      'default_mode',
      'deny',
      'allow',
      COALESCE(config_json::jsonb -> 'tools' -> 'allow', '[]'::jsonb),
      'deny',
      '[]'::jsonb
    )
  END,
  true
)::text
WHERE jsonb_typeof(config_json::jsonb -> 'tools' -> 'allow') = 'array'
  AND (config_json::jsonb -> 'tools' -> 'default_mode') IS NULL
  AND (config_json::jsonb -> 'tools' -> 'deny') IS NULL;

UPDATE agent_configs
SET config_json = jsonb_set(
  config_json::jsonb,
  '{skills}',
  COALESCE(config_json::jsonb -> 'skills', '{}'::jsonb) - 'enabled',
  true
)::text
WHERE (config_json::jsonb -> 'skills' -> 'enabled') IS NOT NULL;

UPDATE agent_configs
SET config_json = jsonb_set(
  config_json::jsonb,
  '{mcp}',
  COALESCE(config_json::jsonb -> 'mcp', '{}'::jsonb) - 'enabled',
  true
)::text
WHERE (config_json::jsonb -> 'mcp' -> 'enabled') IS NOT NULL;

UPDATE agent_identity_revisions AS revisions
SET identity_json = CASE
  WHEN NULLIF(btrim(revisions.identity_json::jsonb -> 'meta' -> 'style' ->> 'tone'), '') IS NOT NULL THEN jsonb_build_object(
    'meta',
    jsonb_build_object(
      'name',
      COALESCE(
        NULLIF(btrim(revisions.identity_json::jsonb -> 'meta' ->> 'name'), ''),
        (
          SELECT agent_key
          FROM agents
          WHERE agents.tenant_id = revisions.tenant_id
            AND agents.agent_id = revisions.agent_id
          LIMIT 1
        ),
        'Agent'
      ),
      'style',
      jsonb_build_object('tone', revisions.identity_json::jsonb -> 'meta' -> 'style' ->> 'tone')
    )
  )::text
  ELSE jsonb_build_object(
    'meta',
    jsonb_build_object(
      'name',
      COALESCE(
        NULLIF(btrim(revisions.identity_json::jsonb -> 'meta' ->> 'name'), ''),
        (
          SELECT agent_key
          FROM agents
          WHERE agents.tenant_id = revisions.tenant_id
            AND agents.agent_id = revisions.agent_id
          LIMIT 1
        ),
        'Agent'
      )
    )
  )::text
END
WHERE (revisions.identity_json::jsonb -> 'body') IS NOT NULL
   OR (revisions.identity_json::jsonb -> 'meta' -> 'description') IS NOT NULL
   OR (revisions.identity_json::jsonb -> 'meta' -> 'emoji') IS NOT NULL
   OR (revisions.identity_json::jsonb -> 'meta' -> 'style' -> 'verbosity') IS NOT NULL
   OR (revisions.identity_json::jsonb -> 'meta' -> 'style' -> 'format') IS NOT NULL;
