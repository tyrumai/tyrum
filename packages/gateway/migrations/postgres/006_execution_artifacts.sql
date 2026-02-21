-- Execution artifact metadata (v1).
-- Raw bytes live in the ArtifactStore; this table is the durable index-of-record.

CREATE TABLE IF NOT EXISTS execution_artifacts (
  artifact_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT,
  run_id TEXT,
  step_id TEXT,
  attempt_id TEXT,
  kind TEXT NOT NULL,
  uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  sensitivity TEXT NOT NULL DEFAULT 'normal',
  policy_snapshot_id TEXT,
  CONSTRAINT execution_artifacts_run_fk FOREIGN KEY (run_id) REFERENCES execution_runs(run_id),
  CONSTRAINT execution_artifacts_step_fk FOREIGN KEY (step_id) REFERENCES execution_steps(step_id),
  CONSTRAINT execution_artifacts_attempt_fk FOREIGN KEY (attempt_id) REFERENCES execution_attempts(attempt_id)
);

CREATE INDEX IF NOT EXISTS execution_artifacts_workspace_id_idx ON execution_artifacts (workspace_id);
CREATE INDEX IF NOT EXISTS execution_artifacts_agent_id_idx ON execution_artifacts (agent_id);
CREATE INDEX IF NOT EXISTS execution_artifacts_run_id_idx ON execution_artifacts (run_id);
CREATE INDEX IF NOT EXISTS execution_artifacts_step_id_idx ON execution_artifacts (step_id);
CREATE INDEX IF NOT EXISTS execution_artifacts_attempt_id_idx ON execution_artifacts (attempt_id);
CREATE INDEX IF NOT EXISTS execution_artifacts_kind_idx ON execution_artifacts (kind);
CREATE INDEX IF NOT EXISTS execution_artifacts_created_at_idx ON execution_artifacts (created_at);

