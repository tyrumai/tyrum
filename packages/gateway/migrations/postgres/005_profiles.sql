CREATE TABLE IF NOT EXISTS pam_profiles (
  id BIGSERIAL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pam_profiles_subject_profile_unique UNIQUE (subject_id, profile_id)
);

CREATE TABLE IF NOT EXISTS pvp_profiles (
  id BIGSERIAL PRIMARY KEY,
  subject_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  version TEXT,
  profile_data TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pvp_profiles_subject_profile_unique UNIQUE (subject_id, profile_id)
);

