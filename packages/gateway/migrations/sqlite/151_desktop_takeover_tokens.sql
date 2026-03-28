CREATE TABLE IF NOT EXISTS desktop_takeover_conversations (
  conversation_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  token_sha256 TEXT NOT NULL,
  upstream_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, environment_id)
    REFERENCES desktop_environments(tenant_id, environment_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_desktop_takeover_conversations_token
  ON desktop_takeover_conversations (token_sha256);

CREATE INDEX IF NOT EXISTS idx_desktop_takeover_conversations_expiry
  ON desktop_takeover_conversations (expires_at ASC);

CREATE INDEX IF NOT EXISTS idx_desktop_takeover_conversations_environment
  ON desktop_takeover_conversations (tenant_id, environment_id, created_at DESC);
