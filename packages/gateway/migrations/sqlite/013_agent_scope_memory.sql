-- Scope durable memory tables per agent_id (multi-agent isolation).

-- facts
ALTER TABLE facts ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS facts_agent_key_idx ON facts (agent_id, fact_key);
CREATE INDEX IF NOT EXISTS facts_agent_observed_idx ON facts (agent_id, observed_at DESC);

-- episodic_events
ALTER TABLE episodic_events ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS episodic_events_agent_occurred_idx ON episodic_events (agent_id, occurred_at DESC);

-- vector_metadata
ALTER TABLE vector_metadata ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS vector_metadata_agent_created_idx ON vector_metadata (agent_id, created_at DESC);

-- capability_memories (rebuild to update UNIQUE constraint)
ALTER TABLE capability_memories RENAME TO capability_memories_old;

CREATE TABLE capability_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL DEFAULT 'default',
  capability_type TEXT NOT NULL,
  capability_identifier TEXT NOT NULL,
  executor_kind TEXT NOT NULL,
  selectors TEXT,
  outcome_metadata TEXT,
  cost_profile TEXT,
  anti_bot_notes TEXT,
  result_summary TEXT,
  success_count INTEGER NOT NULL DEFAULT 1,
  last_success_at TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, capability_type, capability_identifier, executor_kind)
);

INSERT INTO capability_memories (
  agent_id,
  capability_type,
  capability_identifier,
  executor_kind,
  selectors,
  outcome_metadata,
  cost_profile,
  anti_bot_notes,
  result_summary,
  success_count,
  last_success_at,
  metadata,
  created_at,
  updated_at
)
SELECT
  'default' AS agent_id,
  capability_type,
  capability_identifier,
  executor_kind,
  selectors,
  outcome_metadata,
  cost_profile,
  anti_bot_notes,
  result_summary,
  success_count,
  last_success_at,
  metadata,
  created_at,
  updated_at
FROM capability_memories_old;

DROP TABLE capability_memories_old;

CREATE INDEX IF NOT EXISTS capability_memories_agent_type_idx
  ON capability_memories (agent_id, capability_type);
CREATE INDEX IF NOT EXISTS capability_memories_agent_success_idx
  ON capability_memories (agent_id, last_success_at DESC);

-- pam_profiles (rebuild to update UNIQUE constraint)
ALTER TABLE pam_profiles RENAME TO pam_profiles_old;

CREATE TABLE pam_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL DEFAULT 'default',
  profile_id TEXT NOT NULL,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, profile_id)
);

INSERT INTO pam_profiles (
  agent_id,
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
)
SELECT
  'default' AS agent_id,
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
FROM pam_profiles_old;

DROP TABLE pam_profiles_old;

CREATE INDEX IF NOT EXISTS pam_profiles_agent_id_idx ON pam_profiles (agent_id);

-- pvp_profiles (rebuild to update UNIQUE constraint)
ALTER TABLE pvp_profiles RENAME TO pvp_profiles_old;

CREATE TABLE pvp_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL DEFAULT 'default',
  profile_id TEXT NOT NULL,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, profile_id)
);

INSERT INTO pvp_profiles (
  agent_id,
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
)
SELECT
  'default' AS agent_id,
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
FROM pvp_profiles_old;

DROP TABLE pvp_profiles_old;

CREATE INDEX IF NOT EXISTS pvp_profiles_agent_id_idx ON pvp_profiles (agent_id);

