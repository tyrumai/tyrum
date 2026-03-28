ALTER TABLE conversations
  ADD COLUMN context_state_json TEXT NOT NULL DEFAULT '{"version":1,"recent_message_ids":[],"checkpoint":null,"pending_approvals":[],"pending_tool_state":[],"updated_at":"1970-01-01T00:00:00.000Z"}';

UPDATE conversations
SET context_state_json = '{"version":1,"recent_message_ids":[],"checkpoint":null,"pending_approvals":[],"pending_tool_state":[],"updated_at":"1970-01-01T00:00:00.000Z"}'
WHERE context_state_json IS NULL OR trim(context_state_json) = '';

ALTER TABLE conversations DROP COLUMN transcript_json;
ALTER TABLE conversations DROP COLUMN summary;
