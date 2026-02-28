-- Node pairing: scoped node tokens (Postgres)

ALTER TABLE node_pairings
  ADD COLUMN IF NOT EXISTS scoped_token_sha256 TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS node_pairings_scoped_token_sha256_uq
  ON node_pairings (scoped_token_sha256)
  WHERE scoped_token_sha256 IS NOT NULL;

