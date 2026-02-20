ALTER TABLE planner_events ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE planner_events ADD COLUMN IF NOT EXISTS event_hash TEXT;
ALTER TABLE episodic_events ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE episodic_events ADD COLUMN IF NOT EXISTS event_hash TEXT;

