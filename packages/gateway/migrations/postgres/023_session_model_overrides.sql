-- Per-session model overrides (slash command /model).

CREATE TABLE IF NOT EXISTS session_model_overrides (
  agent_id TEXT NOT NULL DEFAULT 'default',
  session_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, session_id),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS session_model_overrides_updated_at_idx
ON session_model_overrides (updated_at DESC);

