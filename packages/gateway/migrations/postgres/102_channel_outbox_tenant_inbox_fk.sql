-- Enforce tenant-scoped FK for channel_outbox → channel_inbox.

CREATE UNIQUE INDEX IF NOT EXISTS channel_inbox_tenant_inbox_uq
ON channel_inbox (tenant_id, inbox_id);

ALTER TABLE channel_outbox DROP CONSTRAINT IF EXISTS channel_outbox_inbox_fk;

ALTER TABLE channel_outbox
  ADD CONSTRAINT channel_outbox_inbox_fk
  FOREIGN KEY (tenant_id, inbox_id)
  REFERENCES channel_inbox(tenant_id, inbox_id)
  ON DELETE CASCADE;
