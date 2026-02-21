-- 022_execution_engine_idempotency.sql
ALTER TABLE execution_jobs ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS execution_jobs_request_id_unique ON execution_jobs (request_id);

