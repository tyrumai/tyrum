-- Durable WorkSignal firings with DB-leases + dedupe + retry/backoff.

CREATE TABLE IF NOT EXISTS work_signal_firings (
  firing_id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL REFERENCES work_signals(signal_id),
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'enqueued', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms BIGINT,
  lease_owner TEXT,
  lease_expires_at_ms BIGINT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (signal_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS work_signal_firings_status_idx ON work_signal_firings (status);
CREATE INDEX IF NOT EXISTS work_signal_firings_next_attempt_at_ms_idx
ON work_signal_firings (next_attempt_at_ms);
CREATE INDEX IF NOT EXISTS work_signal_firings_lease_expires_at_ms_idx
ON work_signal_firings (lease_expires_at_ms);
