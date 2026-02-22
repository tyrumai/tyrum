-- Multi-agent scoping for sessions + durable memory (SQLite).

-- Sessions: add agent_id so sessions can be isolated per agent.
ALTER TABLE sessions ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS sessions_agent_id_idx ON sessions (agent_id);

-- Facts: scope per agent.
ALTER TABLE facts ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS facts_agent_id_idx ON facts (agent_id);
CREATE INDEX IF NOT EXISTS facts_agent_key_idx ON facts (agent_id, fact_key);

-- Episodic events: scope per agent.
ALTER TABLE episodic_events ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS episodic_events_agent_id_idx ON episodic_events (agent_id);

-- Vector metadata: scope per agent (semantic search isolation).
ALTER TABLE vector_metadata ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS vector_metadata_agent_id_idx ON vector_metadata (agent_id);

-- Capability memories: rebuild to make uniqueness per agent.
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
  id,
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
  id,
  'default',
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

CREATE INDEX IF NOT EXISTS capability_memories_agent_type_idx ON capability_memories (agent_id, capability_type);
CREATE INDEX IF NOT EXISTS capability_memories_agent_success_idx ON capability_memories (agent_id, last_success_at DESC);

-- Profiles: rebuild to make uniqueness per agent.
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
  id,
  agent_id,
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
)
SELECT
  id,
  'default',
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
FROM pam_profiles_old;

DROP TABLE pam_profiles_old;

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
  id,
  agent_id,
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
)
SELECT
  id,
  'default',
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
FROM pvp_profiles_old;

DROP TABLE pvp_profiles_old;

