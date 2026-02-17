BEGIN TRANSACTION;

-- ---------------------------------------------------------------------------
-- facts
-- ---------------------------------------------------------------------------
ALTER TABLE facts RENAME TO facts_old;

CREATE TABLE facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO facts (id, fact_key, fact_value, source, observed_at, confidence, created_at)
SELECT id, fact_key, fact_value, source, observed_at, confidence, created_at
FROM facts_old;

DROP TABLE facts_old;

CREATE INDEX facts_key_idx ON facts (fact_key);
CREATE INDEX facts_observed_idx ON facts (observed_at DESC);

-- ---------------------------------------------------------------------------
-- episodic_events
-- ---------------------------------------------------------------------------
ALTER TABLE episodic_events RENAME TO episodic_events_old;

CREATE TABLE episodic_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO episodic_events (
  id,
  event_id,
  occurred_at,
  channel,
  event_type,
  payload,
  created_at
)
SELECT
  id,
  event_id,
  occurred_at,
  channel,
  event_type,
  payload,
  created_at
FROM episodic_events_old;

DROP TABLE episodic_events_old;

CREATE INDEX episodic_events_occurred_idx ON episodic_events (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- vector_metadata
-- ---------------------------------------------------------------------------
ALTER TABLE vector_metadata RENAME TO vector_metadata_old;

CREATE TABLE vector_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  embedding_id TEXT NOT NULL UNIQUE,
  embedding_model TEXT NOT NULL,
  label TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

WITH ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY embedding_id
      ORDER BY datetime(created_at) DESC, id DESC
    ) AS rn
  FROM vector_metadata_old
)
INSERT INTO vector_metadata (
  embedding_id,
  embedding_model,
  label,
  metadata,
  created_at
)
SELECT
  embedding_id,
  embedding_model,
  label,
  metadata,
  created_at
FROM ranked
WHERE rn = 1;

DROP TABLE vector_metadata_old;

CREATE INDEX vector_metadata_created_idx ON vector_metadata (created_at DESC);

-- ---------------------------------------------------------------------------
-- capability_memories
-- ---------------------------------------------------------------------------
ALTER TABLE capability_memories RENAME TO capability_memories_old;

CREATE TABLE capability_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  UNIQUE(capability_type, capability_identifier, executor_kind)
);

WITH ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY capability_type, capability_identifier, executor_kind
      ORDER BY datetime(updated_at) DESC, id DESC
    ) AS rn
  FROM capability_memories_old
)
INSERT INTO capability_memories (
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
FROM ranked
WHERE rn = 1;

DROP TABLE capability_memories_old;

CREATE INDEX capability_memories_type_idx ON capability_memories (capability_type);
CREATE INDEX capability_memories_success_idx ON capability_memories (last_success_at DESC);

-- ---------------------------------------------------------------------------
-- pam_profiles
-- ---------------------------------------------------------------------------
ALTER TABLE pam_profiles RENAME TO pam_profiles_old;

CREATE TABLE pam_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL UNIQUE,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

WITH ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY profile_id
      ORDER BY datetime(updated_at) DESC, id DESC
    ) AS rn
  FROM pam_profiles_old
)
INSERT INTO pam_profiles (
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
)
SELECT
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
FROM ranked
WHERE rn = 1;

DROP TABLE pam_profiles_old;

-- ---------------------------------------------------------------------------
-- pvp_profiles
-- ---------------------------------------------------------------------------
ALTER TABLE pvp_profiles RENAME TO pvp_profiles_old;

CREATE TABLE pvp_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL UNIQUE,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

WITH ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY profile_id
      ORDER BY datetime(updated_at) DESC, id DESC
    ) AS rn
  FROM pvp_profiles_old
)
INSERT INTO pvp_profiles (
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
)
SELECT
  profile_id,
  version,
  profile_data,
  created_at,
  updated_at
FROM ranked
WHERE rn = 1;

DROP TABLE pvp_profiles_old;

-- ---------------------------------------------------------------------------
-- watchers
-- ---------------------------------------------------------------------------
ALTER TABLE watchers RENAME TO watchers_old;

CREATE TABLE watchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO watchers (
  id,
  plan_id,
  trigger_type,
  trigger_config,
  active,
  created_at,
  updated_at
)
SELECT
  id,
  plan_id,
  trigger_type,
  trigger_config,
  active,
  created_at,
  updated_at
FROM watchers_old;

DROP TABLE watchers_old;

CREATE INDEX watchers_active_idx ON watchers (active);
CREATE INDEX watchers_plan_id_idx ON watchers (plan_id);

COMMIT;
