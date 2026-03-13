ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS messages_json TEXT NOT NULL DEFAULT '[]';

UPDATE sessions
SET messages_json = '[]'
WHERE messages_json IS NULL OR btrim(messages_json) = '';
