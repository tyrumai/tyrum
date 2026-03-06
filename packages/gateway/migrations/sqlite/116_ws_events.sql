CREATE TABLE ws_events (
  tenant_id     TEXT NOT NULL,
  event_key     TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  type          TEXT NOT NULL,
  occurred_at   TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  audience_json TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, event_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  UNIQUE (event_id)
);
