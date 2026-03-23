ALTER TABLE session_lane_node_attachments
  ADD COLUMN desktop_environment_id TEXT;

ALTER TABLE session_lane_node_attachments
  ADD COLUMN last_activity_at_ms INTEGER;

UPDATE session_lane_node_attachments
SET last_activity_at_ms = updated_at_ms
WHERE last_activity_at_ms IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_lane_node_attachments_desktop_environment
  ON session_lane_node_attachments (tenant_id, desktop_environment_id)
  WHERE desktop_environment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_session_lane_node_attachments_managed_idle
  ON session_lane_node_attachments (tenant_id, last_activity_at_ms ASC)
  WHERE desktop_environment_id IS NOT NULL;
