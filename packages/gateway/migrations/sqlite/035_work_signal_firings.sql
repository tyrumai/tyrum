-- Durable WorkSignal firings with DB-leases + dedupe + retry/backoff.

CREATE TABLE IF NOT EXISTS work_signal_firings (
  firing_id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'enqueued', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER,
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (signal_id, dedupe_key),
  FOREIGN KEY (signal_id) REFERENCES work_signals(signal_id)
);

CREATE INDEX IF NOT EXISTS work_signal_firings_status_idx ON work_signal_firings (status);
CREATE INDEX IF NOT EXISTS work_signal_firings_next_attempt_at_ms_idx
ON work_signal_firings (next_attempt_at_ms);
CREATE INDEX IF NOT EXISTS work_signal_firings_lease_expires_at_ms_idx
ON work_signal_firings (lease_expires_at_ms);

