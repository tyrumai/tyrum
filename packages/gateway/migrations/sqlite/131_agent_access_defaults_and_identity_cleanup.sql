UPDATE agent_configs
SET config_json = json_remove(config_json, '$.persona.description')
WHERE json_type(config_json, '$.persona.description') IS NOT NULL;

UPDATE agent_configs
SET config_json = json_set(
  json_remove(config_json, '$.skills'),
  '$.skills',
  json_object(
    'default_mode',
    'deny',
    'allow',
    json(COALESCE(json_extract(config_json, '$.skills.enabled'), '[]')),
    'deny',
    json('[]'),
    'workspace_trusted',
    CASE
      WHEN json_extract(config_json, '$.skills.workspace_trusted') THEN json('true')
      ELSE json('false')
    END
  )
)
WHERE json_type(config_json, '$.skills.enabled') = 'array'
  AND json_type(config_json, '$.skills.default_mode') IS NULL;

UPDATE agent_configs
SET config_json = json_set(
  json_remove(config_json, '$.mcp'),
  '$.mcp',
  json_object(
    'default_mode',
    'deny',
    'allow',
    json(COALESCE(json_extract(config_json, '$.mcp.enabled'), '[]')),
    'deny',
    json('[]')
  )
)
WHERE json_type(config_json, '$.mcp.enabled') = 'array'
  AND json_type(config_json, '$.mcp.default_mode') IS NULL;

UPDATE agent_configs
SET config_json = json_set(
  json_remove(config_json, '$.tools'),
  '$.tools',
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM json_each(COALESCE(json_extract(config_json, '$.tools.allow'), '[]'))
      WHERE trim(CAST(value AS TEXT)) IN ('*', 'tool.*')
    ) THEN json_object(
      'default_mode',
      'allow',
      'allow',
      json('[]'),
      'deny',
      json('[]')
    )
    WHEN EXISTS (
      SELECT 1
      FROM json_each(COALESCE(json_extract(config_json, '$.tools.allow'), '[]'))
      WHERE trim(CAST(value AS TEXT)) = 'tool.fs.*'
    ) THEN json_object(
      'default_mode',
      'deny',
      'allow',
      json(
        COALESCE(
          (
            SELECT json_group_array(entry.id)
            FROM (
              SELECT deduped.id
              FROM (
                SELECT expanded.id, MIN(expanded.order_key) AS order_key
                FROM (
                  SELECT trim(CAST(fs.value AS TEXT)) AS id,
                         (CAST(tool.key AS INTEGER) * 10) + CAST(fs.key AS INTEGER) AS order_key
                  FROM json_each(COALESCE(json_extract(config_json, '$.tools.allow'), '[]')) AS tool
                  JOIN json_each('["read","write","edit","apply_patch","glob","grep"]') AS fs
                  WHERE trim(CAST(tool.value AS TEXT)) = 'tool.fs.*'
                  UNION ALL
                  SELECT trim(CAST(tool.value AS TEXT)) AS id,
                         CAST(tool.key AS INTEGER) * 10 AS order_key
                  FROM json_each(COALESCE(json_extract(config_json, '$.tools.allow'), '[]')) AS tool
                  WHERE trim(CAST(tool.value AS TEXT)) <> 'tool.fs.*'
                ) AS expanded
                GROUP BY expanded.id
              ) AS deduped
              ORDER BY deduped.order_key
            ) AS entry
          ),
          '[]'
        )
      ),
      'deny',
      json('[]')
    )
    ELSE json_object(
      'default_mode',
      'deny',
      'allow',
      json(COALESCE(json_extract(config_json, '$.tools.allow'), '[]')),
      'deny',
      json('[]')
    )
  END
)
WHERE json_type(config_json, '$.tools.allow') = 'array'
  AND json_type(config_json, '$.tools.default_mode') IS NULL
  AND json_type(config_json, '$.tools.deny') IS NULL;

UPDATE agent_configs
SET config_json = json_remove(config_json, '$.skills.enabled')
WHERE json_type(config_json, '$.skills.enabled') IS NOT NULL;

UPDATE agent_configs
SET config_json = json_remove(config_json, '$.mcp.enabled')
WHERE json_type(config_json, '$.mcp.enabled') IS NOT NULL;

UPDATE agent_identity_revisions
SET identity_json = CASE
  WHEN NULLIF(trim(json_extract(identity_json, '$.meta.style.tone')), '') IS NOT NULL THEN json_object(
    'meta',
    json_object(
      'name',
      COALESCE(
        NULLIF(trim(json_extract(identity_json, '$.meta.name')), ''),
        (
          SELECT agent_key
          FROM agents
          WHERE agents.tenant_id = agent_identity_revisions.tenant_id
            AND agents.agent_id = agent_identity_revisions.agent_id
          LIMIT 1
        ),
        'Agent'
      ),
      'style',
      json_object('tone', json_extract(identity_json, '$.meta.style.tone'))
    )
  )
  ELSE json_object(
    'meta',
    json_object(
      'name',
      COALESCE(
        NULLIF(trim(json_extract(identity_json, '$.meta.name')), ''),
        (
          SELECT agent_key
          FROM agents
          WHERE agents.tenant_id = agent_identity_revisions.tenant_id
            AND agents.agent_id = agent_identity_revisions.agent_id
          LIMIT 1
        ),
        'Agent'
      )
    )
  )
END
WHERE json_type(identity_json, '$.body') IS NOT NULL
   OR json_type(identity_json, '$.meta.description') IS NOT NULL
   OR json_type(identity_json, '$.meta.emoji') IS NOT NULL
   OR json_type(identity_json, '$.meta.style.verbosity') IS NOT NULL
   OR json_type(identity_json, '$.meta.style.format') IS NOT NULL;
