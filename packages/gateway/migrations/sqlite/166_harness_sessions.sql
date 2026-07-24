CREATE TABLE harness_sessions (
  tenant_id       TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  backend_id      TEXT NOT NULL,
  session_ref     TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, conversation_id, backend_id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, conversation_id) ON DELETE CASCADE
);
