-- Node pairing: trust level + capability allowlist (SQLite)

ALTER TABLE node_pairings
  ADD COLUMN trust_level TEXT NOT NULL DEFAULT 'remote' CHECK (trust_level IN ('local', 'remote'));

ALTER TABLE node_pairings
  ADD COLUMN capability_allowlist_json TEXT NOT NULL DEFAULT '[]';

