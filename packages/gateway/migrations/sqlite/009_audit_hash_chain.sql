ALTER TABLE planner_events ADD COLUMN prev_hash TEXT;
ALTER TABLE planner_events ADD COLUMN event_hash TEXT;
ALTER TABLE episodic_events ADD COLUMN prev_hash TEXT;
ALTER TABLE episodic_events ADD COLUMN event_hash TEXT;

