CREATE TABLE IF NOT EXISTS watchers (
  id BIGSERIAL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS watchers_subject_active_idx ON watchers (subject_id, active);
CREATE INDEX IF NOT EXISTS watchers_plan_id_idx ON watchers (plan_id);

