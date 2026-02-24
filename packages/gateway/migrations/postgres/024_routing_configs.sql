-- Durable editable routing rule state (routing configs).

CREATE TABLE IF NOT EXISTS routing_configs (
  revision BIGSERIAL PRIMARY KEY,
  config_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT
);

CREATE INDEX IF NOT EXISTS routing_configs_created_at_idx ON routing_configs (created_at);

