CREATE TABLE IF NOT EXISTS conversation_node_attachments (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  source_client_device_id TEXT,
  attached_node_id TEXT,
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE INDEX IF NOT EXISTS idx_conversation_node_attachments_updated
  ON conversation_node_attachments (tenant_id, updated_at_ms DESC);
