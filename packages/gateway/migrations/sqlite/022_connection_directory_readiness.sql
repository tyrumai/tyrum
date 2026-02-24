-- Connection directory: capability readiness (SQLite)

ALTER TABLE connection_directory
  ADD COLUMN ready_capabilities_json TEXT;
