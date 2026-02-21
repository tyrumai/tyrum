-- Multi-agent scoping for sessions + durable memory (Postgres).

-- Sessions: add agent_id so sessions can be isolated per agent.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS sessions_agent_id_idx ON sessions (agent_id);

-- Facts: scope per agent.
ALTER TABLE facts ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS facts_agent_id_idx ON facts (agent_id);
CREATE INDEX IF NOT EXISTS facts_agent_key_idx ON facts (agent_id, fact_key);

-- Episodic events: scope per agent.
ALTER TABLE episodic_events ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS episodic_events_agent_id_idx ON episodic_events (agent_id);

-- Vector metadata: scope per agent (semantic search isolation).
ALTER TABLE vector_metadata ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS vector_metadata_agent_id_idx ON vector_metadata (agent_id);

-- Capability memories: uniqueness should be per agent.
ALTER TABLE capability_memories ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE capability_memories DROP CONSTRAINT IF EXISTS capability_memories_unique;
ALTER TABLE capability_memories ADD CONSTRAINT capability_memories_agent_unique UNIQUE (
  agent_id,
  capability_type,
  capability_identifier,
  executor_kind
);
CREATE INDEX IF NOT EXISTS capability_memories_agent_type_idx ON capability_memories (agent_id, capability_type);
CREATE INDEX IF NOT EXISTS capability_memories_agent_success_idx ON capability_memories (agent_id, last_success_at DESC);

-- Profiles: uniqueness should be per agent.
ALTER TABLE pam_profiles ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE pam_profiles DROP CONSTRAINT IF EXISTS pam_profiles_profile_unique;
ALTER TABLE pam_profiles ADD CONSTRAINT pam_profiles_agent_profile_unique UNIQUE (agent_id, profile_id);

ALTER TABLE pvp_profiles ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE pvp_profiles DROP CONSTRAINT IF EXISTS pvp_profiles_profile_unique;
ALTER TABLE pvp_profiles ADD CONSTRAINT pvp_profiles_agent_profile_unique UNIQUE (agent_id, profile_id);

