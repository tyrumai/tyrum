CREATE TABLE extension_defaults (
  tenant_id      TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('skill', 'mcp')),
  extension_id   TEXT NOT NULL,
  default_access TEXT CHECK (default_access IN ('allow', 'deny')),
  settings_json  TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (tenant_id, kind, extension_id)
);

CREATE INDEX extension_defaults_kind_idx
ON extension_defaults (tenant_id, kind, updated_at DESC, extension_id ASC);
