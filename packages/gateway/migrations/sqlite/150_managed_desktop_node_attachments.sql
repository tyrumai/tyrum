ALTER TABLE conversation_node_attachments
  ADD COLUMN desktop_environment_id TEXT;

ALTER TABLE conversation_node_attachments
  ADD COLUMN last_activity_at_ms INTEGER;

UPDATE conversation_node_attachments
SET last_activity_at_ms = updated_at_ms
WHERE last_activity_at_ms IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_node_attachments_desktop_environment
  ON conversation_node_attachments (tenant_id, desktop_environment_id)
  WHERE desktop_environment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_node_attachments_managed_idle
  ON conversation_node_attachments (tenant_id, last_activity_at_ms ASC)
  WHERE desktop_environment_id IS NOT NULL;
