CREATE INDEX IF NOT EXISTS sessions_agent_channel_updated_idx
  ON sessions (agent_id, channel, updated_at DESC);

