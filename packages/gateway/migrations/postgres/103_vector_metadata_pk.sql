-- Rename Postgres PK column to match SQLite + DAL expectations.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vector_metadata'
      AND column_name = 'id'
  ) THEN
    EXECUTE 'ALTER TABLE vector_metadata RENAME COLUMN id TO vector_metadata_id';
  END IF;
END $$;
-- pg-mem (used in tests) does not preserve SERIAL defaults on rename; re-assert explicitly.
CREATE SEQUENCE IF NOT EXISTS vector_metadata_id_seq;
ALTER TABLE vector_metadata
  ALTER COLUMN vector_metadata_id SET DEFAULT nextval('vector_metadata_id_seq');

