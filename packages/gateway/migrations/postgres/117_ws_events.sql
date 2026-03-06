CREATE TABLE ws_events (
  tenant_id     UUID NOT NULL,
  event_key     TEXT NOT NULL,
  event_id      TEXT NOT NULL,
  type          TEXT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  payload_json  TEXT NOT NULL,
  audience_json TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, event_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  UNIQUE (event_id)
);
