-- Per-session send policy overrides (slash command /send).

CREATE TABLE IF NOT EXISTS session_send_policy_overrides (
  key TEXT NOT NULL PRIMARY KEY,
  send_policy TEXT NOT NULL CHECK (send_policy IN ('on', 'off')),
  updated_at_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS session_send_policy_overrides_updated_at_ms_idx
ON session_send_policy_overrides (updated_at_ms DESC);

