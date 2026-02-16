CREATE TABLE IF NOT EXISTS pam_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(subject_id, profile_id)
);

CREATE TABLE IF NOT EXISTS pvp_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(subject_id, profile_id)
);
