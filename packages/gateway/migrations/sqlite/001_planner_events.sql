CREATE TABLE IF NOT EXISTS planner_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  replay_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  step_index INTEGER NOT NULL CHECK(step_index >= 0),
  occurred_at TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(plan_id, step_index)
);

CREATE INDEX IF NOT EXISTS planner_events_plan_id_idx ON planner_events (plan_id);
CREATE INDEX IF NOT EXISTS planner_events_replay_id_idx ON planner_events (replay_id);

