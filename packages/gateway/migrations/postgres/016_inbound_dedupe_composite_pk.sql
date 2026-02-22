-- Ensure inbound message dedupe is scoped by (message_id, channel).
-- Prior schema used message_id as the lone PK, which could silently drop
-- records when message_ids collide across channels.

ALTER TABLE inbound_dedupe
  DROP CONSTRAINT IF EXISTS inbound_dedupe_pkey;

ALTER TABLE inbound_dedupe
  ADD PRIMARY KEY (message_id, channel);
