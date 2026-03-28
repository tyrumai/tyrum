ALTER TABLE conversations ADD COLUMN messages_json TEXT NOT NULL DEFAULT '[]';

UPDATE conversations
SET messages_json = '[]'
WHERE messages_json IS NULL OR trim(messages_json) = '';
