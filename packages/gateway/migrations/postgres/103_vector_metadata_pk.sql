-- Rename Postgres PK column to match SQLite + DAL expectations.
ALTER TABLE vector_metadata RENAME COLUMN id TO vector_metadata_id;
-- pg-mem (used in tests) does not preserve SERIAL defaults on rename; re-assert explicitly.
CREATE SEQUENCE IF NOT EXISTS vector_metadata_id_seq;
ALTER TABLE vector_metadata
  ALTER COLUMN vector_metadata_id SET DEFAULT nextval('vector_metadata_id_seq');
