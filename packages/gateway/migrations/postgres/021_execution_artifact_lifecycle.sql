-- Artifact lifecycle tracking (Postgres).
-- Adds retention/GC metadata so artifact bytes can be pruned while keeping durable indexes.

ALTER TABLE execution_artifacts ADD COLUMN IF NOT EXISTS retention_expires_at TIMESTAMPTZ;
ALTER TABLE execution_artifacts ADD COLUMN IF NOT EXISTS bytes_deleted_at TIMESTAMPTZ;
ALTER TABLE execution_artifacts ADD COLUMN IF NOT EXISTS bytes_deleted_reason TEXT;

CREATE INDEX IF NOT EXISTS execution_artifacts_retention_expires_at_idx ON execution_artifacts (retention_expires_at);
CREATE INDEX IF NOT EXISTS execution_artifacts_bytes_deleted_at_idx ON execution_artifacts (bytes_deleted_at);

