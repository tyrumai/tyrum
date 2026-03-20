ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE agents AS target
SET is_primary = TRUE
WHERE target.agent_key = 'default'
  AND NOT EXISTS (
    SELECT 1
    FROM agents AS existing
    WHERE existing.tenant_id = target.tenant_id
      AND existing.is_primary = TRUE
  );

CREATE UNIQUE INDEX IF NOT EXISTS agents_primary_per_tenant_idx
ON agents (tenant_id)
WHERE is_primary = TRUE;
