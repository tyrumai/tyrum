CREATE TABLE IF NOT EXISTS capability_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
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
  UNIQUE(subject_id, capability_type, capability_identifier, executor_kind)
);

CREATE INDEX IF NOT EXISTS capability_memories_subject_type_idx ON capability_memories (subject_id, capability_type);

