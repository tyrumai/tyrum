ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE agents
SET is_primary = TRUE
WHERE agent_key = 'default'
  AND tenant_id NOT IN (
    SELECT tenant_id
    FROM agents
    WHERE is_primary = TRUE
  );

CREATE UNIQUE INDEX IF NOT EXISTS agents_primary_per_tenant_idx
ON agents (
  tenant_id,
  (CASE WHEN is_primary THEN 'primary' ELSE NULL END)
);
