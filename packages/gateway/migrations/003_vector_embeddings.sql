CREATE TABLE IF NOT EXISTS vector_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  embedding_id TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  label TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(subject_id, embedding_id)
);

CREATE INDEX IF NOT EXISTS vector_metadata_subject_created_idx ON vector_metadata (subject_id, created_at DESC);
