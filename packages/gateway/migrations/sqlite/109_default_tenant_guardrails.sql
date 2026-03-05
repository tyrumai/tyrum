-- tyrum:disable_foreign_keys

-- Reduce default-tenant footguns for future multi-tenant safety.

-- ---------------------------------------------------------------------------
-- Routing configs (tenant-scoped; require explicit tenant_id)
-- ---------------------------------------------------------------------------

CREATE TABLE routing_configs_new (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  config_json TEXT NOT NULL CHECK (json_valid(config_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  reverted_from_revision INTEGER,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

INSERT INTO routing_configs_new (
  revision,
  tenant_id,
  config_json,
  created_at,
  created_by_json,
  reason,
  reverted_from_revision
)
SELECT
  revision,
  tenant_id,
  config_json,
  created_at,
  created_by_json,
  reason,
  reverted_from_revision
FROM routing_configs;

DROP TABLE routing_configs;
ALTER TABLE routing_configs_new RENAME TO routing_configs;

CREATE INDEX IF NOT EXISTS routing_configs_revision_idx
ON routing_configs (tenant_id, revision DESC);

CREATE INDEX IF NOT EXISTS routing_configs_created_at_idx
ON routing_configs (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Models dev cache/leases (global-by-design; remove tenant_id)
-- ---------------------------------------------------------------------------

CREATE TABLE models_dev_cache_new (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fetched_at TEXT NULL,
  etag TEXT NULL,
  sha256 TEXT NOT NULL,
  json TEXT NOT NULL,
  source TEXT NOT NULL,
  last_error TEXT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO models_dev_cache_new (
  id,
  fetched_at,
  etag,
  sha256,
  json,
  source,
  last_error,
  updated_at
)
SELECT
  id,
  fetched_at,
  etag,
  sha256,
  json,
  source,
  last_error,
  updated_at
FROM models_dev_cache;

DROP TABLE models_dev_cache;
ALTER TABLE models_dev_cache_new RENAME TO models_dev_cache;

CREATE TABLE models_dev_refresh_leases_new (
  key                 TEXT PRIMARY KEY,
  lease_owner         TEXT NOT NULL,
  lease_expires_at_ms INTEGER NOT NULL
);

INSERT INTO models_dev_refresh_leases_new (key, lease_owner, lease_expires_at_ms)
SELECT key, lease_owner, lease_expires_at_ms
FROM models_dev_refresh_leases;

DROP TABLE models_dev_refresh_leases;
ALTER TABLE models_dev_refresh_leases_new RENAME TO models_dev_refresh_leases;
