ALTER TABLE auth_tokens ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE auth_tokens ADD COLUMN updated_at TEXT;

UPDATE auth_tokens
SET display_name =
  CASE
    WHEN trim(COALESCE(device_id, '')) <> '' THEN trim(device_id)
    WHEN role = 'admin' THEN 'Admin token'
    WHEN role = 'node' THEN 'Node token'
    ELSE 'Client token'
  END
WHERE trim(display_name) = '';

UPDATE auth_tokens
SET updated_at = created_at;
