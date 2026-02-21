-- 012_artifacts.sql
--
-- Persist artifact metadata in the StateStore. Raw bytes remain in the configured
-- ArtifactStore (filesystem or S3). This table is the durable index and
-- authorization hook point for artifact fetches and exports.

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  run_id TEXT,
  step_id TEXT,
  attempt_id TEXT,
  uri TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]',
  sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal', 'sensitive')),
  metadata_json TEXT,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  last_fetched_at TEXT,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS artifacts_agent_id_idx ON artifacts (agent_id);
CREATE INDEX IF NOT EXISTS artifacts_workspace_id_idx ON artifacts (workspace_id);
CREATE INDEX IF NOT EXISTS artifacts_run_id_idx ON artifacts (run_id);
CREATE INDEX IF NOT EXISTS artifacts_step_id_idx ON artifacts (step_id);
CREATE INDEX IF NOT EXISTS artifacts_attempt_id_idx ON artifacts (attempt_id);

