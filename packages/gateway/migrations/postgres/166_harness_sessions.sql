CREATE TABLE harness_sessions (
  tenant_id       UUID NOT NULL,
  conversation_id UUID NOT NULL,
  backend_id      TEXT NOT NULL,
  session_ref     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, conversation_id, backend_id),
  CONSTRAINT harness_sessions_conversation_fk
    FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, conversation_id) ON DELETE CASCADE
);
