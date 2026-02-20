ALTER TABLE execution_attempts
ADD COLUMN IF NOT EXISTS cost_json TEXT;

