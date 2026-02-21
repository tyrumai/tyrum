-- 080_auth_profiles.sql

CREATE TABLE IF NOT EXISTS auth_profiles (
  profile_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('api_key', 'oauth', 'token')),
  oauth_json TEXT,
  secret_handles_json TEXT NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  labels_json TEXT NOT NULL DEFAULT '{}',
  disabled_at TIMESTAMPTZ,
  disabled_reason TEXT,
  cooldown_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_profiles_agent_provider_idx ON auth_profiles (agent_id, provider);
CREATE INDEX IF NOT EXISTS auth_profiles_provider_idx ON auth_profiles (provider);

CREATE TABLE IF NOT EXISTS session_auth_pins (
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, provider)
);

CREATE INDEX IF NOT EXISTS session_auth_pins_profile_id_idx ON session_auth_pins (profile_id);
