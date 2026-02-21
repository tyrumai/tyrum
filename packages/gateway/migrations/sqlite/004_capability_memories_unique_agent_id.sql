-- capability_memories should be isolated per agent.

CREATE TABLE capability_memories__new (
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
  agent_id TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(capability_type, capability_identifier, executor_kind, agent_id)
);

INSERT INTO capability_memories__new (
  id,
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
  agent_id,
  created_at,
  updated_at
)
SELECT
  id,
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
  agent_id,
  created_at,
  updated_at
FROM capability_memories;

DROP TABLE capability_memories;

ALTER TABLE capability_memories__new RENAME TO capability_memories;

CREATE INDEX IF NOT EXISTS capability_memories_type_idx ON capability_memories (capability_type);
CREATE INDEX IF NOT EXISTS capability_memories_success_idx ON capability_memories (last_success_at DESC);
CREATE INDEX IF NOT EXISTS idx_capability_memories_agent ON capability_memories (agent_id);

