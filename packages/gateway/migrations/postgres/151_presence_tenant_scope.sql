ALTER TABLE presence_entries RENAME TO presence_entries_legacy;

CREATE TABLE presence_entries_tenant_scoped (
  tenant_id          UUID NOT NULL,
  instance_id        TEXT NOT NULL,
  role               TEXT NOT NULL CHECK (role IN ('gateway','client','node')),
  connection_id      TEXT,
  host               TEXT,
  ip                 TEXT,
  version            TEXT,
  mode               TEXT,
  last_input_seconds INTEGER,
  metadata_json      TEXT NOT NULL DEFAULT '{}',
  connected_at_ms    BIGINT NOT NULL,
  last_seen_at_ms    BIGINT NOT NULL,
  expires_at_ms      BIGINT NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, instance_id)
);

INSERT INTO presence_entries_tenant_scoped (
  tenant_id,
  instance_id,
  role,
  connection_id,
  host,
  ip,
  version,
  mode,
  last_input_seconds,
  metadata_json,
  connected_at_ms,
  last_seen_at_ms,
  expires_at_ms,
  updated_at
)
SELECT COALESCE(
         c.tenant_id,
         '00000000-0000-4000-8000-000000000001'
       )::uuid AS tenant_id,
       presence_entries_legacy.instance_id,
       presence_entries_legacy.role,
       presence_entries_legacy.connection_id,
       presence_entries_legacy.host,
       presence_entries_legacy.ip,
       presence_entries_legacy.version,
       presence_entries_legacy.mode,
       presence_entries_legacy.last_input_seconds,
       presence_entries_legacy.metadata_json,
       presence_entries_legacy.connected_at_ms,
       presence_entries_legacy.last_seen_at_ms,
       presence_entries_legacy.expires_at_ms,
       presence_entries_legacy.updated_at
FROM presence_entries_legacy
LEFT JOIN connections c
  ON c.connection_id::text = presence_entries_legacy.connection_id;

DROP TABLE presence_entries_legacy;

ALTER TABLE presence_entries_tenant_scoped RENAME TO presence_entries;

CREATE INDEX IF NOT EXISTS presence_entries_expires_prune_idx
  ON presence_entries (tenant_id, expires_at_ms, instance_id);

CREATE INDEX IF NOT EXISTS presence_entries_last_seen_idx
  ON presence_entries (tenant_id, last_seen_at_ms DESC, instance_id);
