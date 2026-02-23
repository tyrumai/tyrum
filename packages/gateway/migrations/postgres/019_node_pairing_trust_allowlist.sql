-- Node pairing: trust level + capability allowlist (Postgres)

ALTER TABLE node_pairings
  ADD COLUMN IF NOT EXISTS trust_level TEXT NOT NULL DEFAULT 'remote' CHECK (trust_level IN ('local', 'remote'));

ALTER TABLE node_pairings
  ADD COLUMN IF NOT EXISTS capability_allowlist_json TEXT NOT NULL DEFAULT '[]';

