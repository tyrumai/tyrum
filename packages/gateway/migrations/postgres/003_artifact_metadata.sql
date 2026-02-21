CREATE TABLE IF NOT EXISTS artifact_metadata (
  artifact_id TEXT PRIMARY KEY,
  run_id TEXT,
  step_id TEXT,
  attempt_id TEXT,
  kind TEXT NOT NULL DEFAULT 'other',
  mime_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  uri TEXT NOT NULL,
  labels_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_artifact_metadata_run_id ON artifact_metadata(run_id);
CREATE INDEX IF NOT EXISTS idx_artifact_metadata_step_id ON artifact_metadata(step_id);
