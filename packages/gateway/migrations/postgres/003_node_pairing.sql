-- 022_node_pairing.sql
CREATE TABLE IF NOT EXISTS node_pairings (
  pairing_id BIGSERIAL PRIMARY KEY,
  node_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'revoked')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  node_label TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  resolution_json TEXT,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS node_pairings_status_idx ON node_pairings (status);
CREATE INDEX IF NOT EXISTS node_pairings_node_id_idx ON node_pairings (node_id);

