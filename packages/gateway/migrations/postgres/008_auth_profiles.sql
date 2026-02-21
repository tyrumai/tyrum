CREATE TABLE IF NOT EXISTS model_auth_profiles (
  profile_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT,
  secret_handle TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_model_auth_profiles_provider ON model_auth_profiles(provider);
