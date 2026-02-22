-- Scope session auth pins by agent_id (multi-agent isolation).

ALTER TABLE session_auth_pins RENAME TO session_auth_pins_old;

CREATE TABLE session_auth_pins (
  agent_id TEXT NOT NULL DEFAULT 'default',
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  pinned_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, session_id, provider)
);

INSERT INTO session_auth_pins (
  agent_id,
  session_id,
  provider,
  profile_id,
  pinned_at,
  updated_at
)
SELECT
  COALESCE((SELECT agent_id FROM auth_profiles ap WHERE ap.profile_id = p.profile_id), 'default') AS agent_id,
  p.session_id,
  p.provider,
  p.profile_id,
  p.pinned_at,
  p.updated_at
FROM session_auth_pins_old p;

DROP TABLE session_auth_pins_old;

CREATE INDEX IF NOT EXISTS session_auth_pins_profile_id_idx ON session_auth_pins (profile_id);
