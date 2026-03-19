ALTER TABLE channel_outbox
ADD COLUMN attachments_json TEXT;

UPDATE channel_outbox
SET attachments_json = '[]'
WHERE attachments_json IS NULL;
