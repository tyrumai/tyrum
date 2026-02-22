CREATE TABLE IF NOT EXISTS nodes (
  node_id TEXT PRIMARY KEY,
  label TEXT,
  capabilities JSONB NOT NULL DEFAULT '[]',
  pairing_status TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_reason TEXT,
  last_seen_at TIMESTAMPTZ,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS node_capabilities (
  node_id TEXT NOT NULL REFERENCES nodes(node_id),
  capability TEXT NOT NULL,
  PRIMARY KEY (node_id, capability)
);
