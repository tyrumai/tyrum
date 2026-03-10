CREATE TABLE IF NOT EXISTS session_lane_node_attachments (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  lane TEXT NOT NULL,
  source_client_device_id TEXT,
  attached_node_id TEXT,
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, key, lane)
);

CREATE INDEX IF NOT EXISTS idx_session_lane_node_attachments_updated
  ON session_lane_node_attachments (tenant_id, updated_at_ms DESC);
