-- Index for session retention pruning (Postgres).
-- Helps delete session_provider_pins rows by session_id without full scans.

CREATE INDEX IF NOT EXISTS session_provider_pins_session_id_idx ON session_provider_pins (session_id);

