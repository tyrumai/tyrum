ALTER TABLE agents ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1));

UPDATE agents
SET is_primary = 1
WHERE agent_key = 'default'
  AND NOT EXISTS (
    SELECT 1
    FROM agents AS existing
    WHERE existing.tenant_id = agents.tenant_id
      AND existing.is_primary = 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS agents_primary_per_tenant_idx
ON agents (tenant_id)
WHERE is_primary = 1;
