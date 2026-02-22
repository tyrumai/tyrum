-- Scope session auth pins by agent_id (multi-agent isolation).

ALTER TABLE session_auth_pins ADD COLUMN agent_id TEXT;

UPDATE session_auth_pins
SET agent_id = auth_profiles.agent_id
FROM auth_profiles
WHERE auth_profiles.profile_id = session_auth_pins.profile_id
  AND session_auth_pins.agent_id IS NULL;

UPDATE session_auth_pins SET agent_id = 'default' WHERE agent_id IS NULL;

ALTER TABLE session_auth_pins ALTER COLUMN agent_id SET NOT NULL;

ALTER TABLE session_auth_pins DROP CONSTRAINT session_auth_pins_pkey;
ALTER TABLE session_auth_pins ADD PRIMARY KEY (agent_id, session_id, provider);
