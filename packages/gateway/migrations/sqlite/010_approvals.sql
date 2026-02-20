CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT,
  response_reason TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS approvals_plan_id_idx ON approvals (plan_id);
CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals (status);
CREATE INDEX IF NOT EXISTS approvals_expires_at_idx ON approvals (expires_at);

