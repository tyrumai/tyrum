-- Scope durable memory tables per agent_id (multi-agent isolation).

-- facts
ALTER TABLE facts ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS facts_agent_key_idx ON facts (agent_id, fact_key);
CREATE INDEX IF NOT EXISTS facts_agent_observed_idx ON facts (agent_id, observed_at DESC);

-- episodic_events
ALTER TABLE episodic_events ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS episodic_events_agent_occurred_idx ON episodic_events (agent_id, occurred_at DESC);

-- vector_metadata
ALTER TABLE vector_metadata ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX IF NOT EXISTS vector_metadata_agent_created_idx ON vector_metadata (agent_id, created_at DESC);

-- capability_memories (update UNIQUE constraint)
ALTER TABLE capability_memories ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE capability_memories DROP CONSTRAINT IF EXISTS capability_memories_unique;
ALTER TABLE capability_memories
  ADD CONSTRAINT capability_memories_agent_unique
  UNIQUE (agent_id, capability_type, capability_identifier, executor_kind);
CREATE INDEX IF NOT EXISTS capability_memories_agent_type_idx
  ON capability_memories (agent_id, capability_type);

-- pam_profiles (update UNIQUE constraint)
ALTER TABLE pam_profiles ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE pam_profiles DROP CONSTRAINT IF EXISTS pam_profiles_profile_unique;
ALTER TABLE pam_profiles
  ADD CONSTRAINT pam_profiles_agent_profile_unique
  UNIQUE (agent_id, profile_id);
CREATE INDEX IF NOT EXISTS pam_profiles_agent_id_idx ON pam_profiles (agent_id);

-- pvp_profiles (update UNIQUE constraint)
ALTER TABLE pvp_profiles ADD COLUMN IF NOT EXISTS agent_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE pvp_profiles DROP CONSTRAINT IF EXISTS pvp_profiles_profile_unique;
ALTER TABLE pvp_profiles
  ADD CONSTRAINT pvp_profiles_agent_profile_unique
  UNIQUE (agent_id, profile_id);
CREATE INDEX IF NOT EXISTS pvp_profiles_agent_id_idx ON pvp_profiles (agent_id);

