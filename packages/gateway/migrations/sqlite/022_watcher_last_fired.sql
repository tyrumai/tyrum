-- Cluster-safe watcher scheduling: persist last fire time in DB.
ALTER TABLE watchers ADD COLUMN last_fired_at_ms INTEGER;

CREATE INDEX IF NOT EXISTS watchers_last_fired_at_ms_idx ON watchers (last_fired_at_ms);

