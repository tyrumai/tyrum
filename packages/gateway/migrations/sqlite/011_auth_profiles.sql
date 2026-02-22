-- Durable auth profiles for model providers (secret handles only).

CREATE TABLE IF NOT EXISTS auth_profiles (
  profile_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL DEFAULT 'default',
  provider TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('api_key', 'oauth', 'token')),
  secret_handles_json TEXT NOT NULL DEFAULT '{}',
  labels_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  disabled_reason TEXT,
  disabled_at TEXT,
  cooldown_until_ms INTEGER,
  expires_at TEXT,
  created_by_json TEXT,
  updated_by_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS auth_profiles_agent_provider_idx ON auth_profiles (agent_id, provider);
CREATE INDEX IF NOT EXISTS auth_profiles_status_idx ON auth_profiles (status);
CREATE INDEX IF NOT EXISTS auth_profiles_cooldown_until_ms_idx ON auth_profiles (cooldown_until_ms);

CREATE TABLE IF NOT EXISTS session_provider_pins (
  agent_id TEXT NOT NULL DEFAULT 'default',
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  pinned_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, session_id, provider),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id),
  FOREIGN KEY (profile_id) REFERENCES auth_profiles(profile_id)
);

CREATE INDEX IF NOT EXISTS session_provider_pins_profile_id_idx ON session_provider_pins (profile_id);

