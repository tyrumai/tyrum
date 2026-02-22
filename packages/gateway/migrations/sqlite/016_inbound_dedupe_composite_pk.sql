-- Ensure inbound message dedupe is scoped by (message_id, channel).
-- Prior schema used message_id as the lone PK, which could silently drop
-- records when message_ids collide across channels.

CREATE TABLE inbound_dedupe__new (
  message_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  PRIMARY KEY (message_id, channel)
);

INSERT INTO inbound_dedupe__new (message_id, channel, received_at, expires_at)
SELECT message_id, channel, received_at, expires_at
FROM inbound_dedupe;

DROP TABLE inbound_dedupe;

ALTER TABLE inbound_dedupe__new RENAME TO inbound_dedupe;

CREATE INDEX IF NOT EXISTS idx_inbound_dedupe_expires ON inbound_dedupe (expires_at);
