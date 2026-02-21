-- Add approval gating metadata for connector outbound sends.

ALTER TABLE channel_outbox ADD COLUMN approval_id INTEGER;

CREATE INDEX IF NOT EXISTS channel_outbox_approval_id_idx ON channel_outbox (approval_id);

