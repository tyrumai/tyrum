-- Connection directory: protocol revision (SQLite)

ALTER TABLE connection_directory ADD COLUMN protocol_rev INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS connection_directory_protocol_rev_idx ON connection_directory (protocol_rev);
