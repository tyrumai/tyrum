ALTER TABLE sessions ADD COLUMN compacted_summary TEXT DEFAULT '';
ALTER TABLE sessions ADD COLUMN compaction_count INTEGER DEFAULT 0;
