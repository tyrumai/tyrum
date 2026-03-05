-- Indexes for channel_outbox claim/list queries.
CREATE INDEX IF NOT EXISTS channel_outbox_inbox_chunk_outbox_idx
ON channel_outbox (inbox_id, chunk_index, outbox_id);

