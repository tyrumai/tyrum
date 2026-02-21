CREATE TABLE IF NOT EXISTS model_auth_profiles (
  profile_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT,
  secret_handle TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_model_auth_profiles_provider ON model_auth_profiles(provider);
