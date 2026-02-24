-- Connection directory: capability readiness (Postgres)

ALTER TABLE connection_directory
  ADD COLUMN IF NOT EXISTS ready_capabilities_json TEXT NOT NULL DEFAULT '[]';

