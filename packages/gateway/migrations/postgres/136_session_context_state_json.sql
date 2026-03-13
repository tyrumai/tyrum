ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS context_state_json JSONB NOT NULL DEFAULT '{"version":1,"recent_message_ids":[],"checkpoint":null,"pending_approvals":[],"pending_tool_state":[],"updated_at":"1970-01-01T00:00:00.000Z"}'::jsonb;

UPDATE sessions
SET context_state_json = '{"version":1,"recent_message_ids":[],"checkpoint":null,"pending_approvals":[],"pending_tool_state":[],"updated_at":"1970-01-01T00:00:00.000Z"}'::jsonb
WHERE context_state_json IS NULL;

ALTER TABLE sessions DROP COLUMN IF EXISTS transcript_json;
ALTER TABLE sessions DROP COLUMN IF EXISTS summary;
