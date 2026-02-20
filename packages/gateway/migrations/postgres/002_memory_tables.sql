CREATE TABLE IF NOT EXISTS facts (
  id BIGSERIAL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS facts_subject_key_idx ON facts (subject_id, fact_key);
CREATE INDEX IF NOT EXISTS facts_subject_observed_idx ON facts (subject_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS episodic_events (
  id BIGSERIAL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS episodic_events_subject_occurred_idx ON episodic_events (subject_id, occurred_at DESC);

