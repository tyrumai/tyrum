CREATE TABLE conversation_execution_backend_overrides (
  tenant_id       UUID NOT NULL,
  conversation_id UUID NOT NULL,
  backend_id      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, conversation_id),
  CONSTRAINT conversation_execution_backend_overrides_conversation_fk
    FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations(tenant_id, conversation_id) ON DELETE CASCADE
);
