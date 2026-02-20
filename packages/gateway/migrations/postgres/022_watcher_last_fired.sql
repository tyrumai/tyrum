-- Cluster-safe watcher scheduling: persist last fire time in DB.
ALTER TABLE watchers ADD COLUMN IF NOT EXISTS last_fired_at_ms BIGINT;

CREATE INDEX IF NOT EXISTS watchers_last_fired_at_ms_idx ON watchers (last_fired_at_ms);

