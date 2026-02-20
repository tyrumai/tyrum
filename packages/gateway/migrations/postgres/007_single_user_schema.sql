BEGIN;

-- ---------------------------------------------------------------------------
-- facts
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS facts_subject_key_idx;
DROP INDEX IF EXISTS facts_subject_observed_idx;

ALTER TABLE facts DROP COLUMN IF EXISTS subject_id;

CREATE INDEX IF NOT EXISTS facts_key_idx ON facts (fact_key);
CREATE INDEX IF NOT EXISTS facts_observed_idx ON facts (observed_at DESC);

-- ---------------------------------------------------------------------------
-- episodic_events
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS episodic_events_subject_occurred_idx;

ALTER TABLE episodic_events DROP COLUMN IF EXISTS subject_id;

CREATE INDEX IF NOT EXISTS episodic_events_occurred_idx ON episodic_events (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- vector_metadata
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS vector_metadata_subject_created_idx;

ALTER TABLE vector_metadata DROP CONSTRAINT IF EXISTS vector_metadata_subject_embedding_unique;
ALTER TABLE vector_metadata DROP COLUMN IF EXISTS subject_id;
ALTER TABLE vector_metadata ADD CONSTRAINT vector_metadata_embedding_unique UNIQUE (embedding_id);

CREATE INDEX IF NOT EXISTS vector_metadata_created_idx ON vector_metadata (created_at DESC);

-- ---------------------------------------------------------------------------
-- capability_memories
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS capability_memories_subject_type_idx;

ALTER TABLE capability_memories DROP CONSTRAINT IF EXISTS capability_memories_subject_unique;
ALTER TABLE capability_memories DROP COLUMN IF EXISTS subject_id;
ALTER TABLE capability_memories ADD CONSTRAINT capability_memories_unique UNIQUE (
  capability_type,
  capability_identifier,
  executor_kind
);

CREATE INDEX IF NOT EXISTS capability_memories_type_idx ON capability_memories (capability_type);
CREATE INDEX IF NOT EXISTS capability_memories_success_idx ON capability_memories (last_success_at DESC);

-- ---------------------------------------------------------------------------
-- pam_profiles
-- ---------------------------------------------------------------------------
ALTER TABLE pam_profiles DROP CONSTRAINT IF EXISTS pam_profiles_subject_profile_unique;
ALTER TABLE pam_profiles DROP COLUMN IF EXISTS subject_id;
ALTER TABLE pam_profiles ADD CONSTRAINT pam_profiles_profile_unique UNIQUE (profile_id);

-- ---------------------------------------------------------------------------
-- pvp_profiles
-- ---------------------------------------------------------------------------
ALTER TABLE pvp_profiles DROP CONSTRAINT IF EXISTS pvp_profiles_subject_profile_unique;
ALTER TABLE pvp_profiles DROP COLUMN IF EXISTS subject_id;
ALTER TABLE pvp_profiles ADD CONSTRAINT pvp_profiles_profile_unique UNIQUE (profile_id);

-- ---------------------------------------------------------------------------
-- watchers
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS watchers_subject_active_idx;
DROP INDEX IF EXISTS watchers_plan_id_idx;

ALTER TABLE watchers DROP COLUMN IF EXISTS subject_id;

CREATE INDEX IF NOT EXISTS watchers_active_idx ON watchers (active);
CREATE INDEX IF NOT EXISTS watchers_plan_id_idx ON watchers (plan_id);

COMMIT;

