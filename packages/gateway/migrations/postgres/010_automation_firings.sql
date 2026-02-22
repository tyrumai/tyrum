-- Durable automation firings (periodic watchers) with DB-leases + dedupe.

CREATE TABLE IF NOT EXISTS watcher_firings (
  firing_id TEXT PRIMARY KEY,
  watcher_id INTEGER NOT NULL,
  plan_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  scheduled_at_ms BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'enqueued', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at_ms BIGINT,
  job_id TEXT,
  run_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (watcher_id, scheduled_at_ms)
);

CREATE INDEX IF NOT EXISTS watcher_firings_status_idx ON watcher_firings (status);
CREATE INDEX IF NOT EXISTS watcher_firings_scheduled_at_ms_idx ON watcher_firings (scheduled_at_ms);
CREATE INDEX IF NOT EXISTS watcher_firings_lease_expires_at_ms_idx ON watcher_firings (lease_expires_at_ms);

