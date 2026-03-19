ALTER TABLE channel_outbox
ADD COLUMN IF NOT EXISTS attachments_json TEXT;

UPDATE channel_outbox
SET attachments_json = '[]'
WHERE attachments_json IS NULL;

ALTER TABLE channel_outbox
ALTER COLUMN attachments_json SET DEFAULT '[]';

ALTER TABLE channel_outbox
ALTER COLUMN attachments_json SET NOT NULL;
