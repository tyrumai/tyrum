-- 081_auth_profile_refresh_locks.sql

CREATE TABLE IF NOT EXISTS auth_profile_refresh_locks (
  profile_id TEXT PRIMARY KEY,
  locked_by TEXT NOT NULL,
  locked_until TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS auth_profile_refresh_locks_locked_until_idx ON auth_profile_refresh_locks (locked_until);

