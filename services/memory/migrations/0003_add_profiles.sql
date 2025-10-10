-- Storage for Policy/Autonomy Model (PAM) and Persona & Voice Profile (PVP) data.
CREATE TABLE IF NOT EXISTS pam_profiles (
    id BIGSERIAL PRIMARY KEY,
    subject_id UUID NOT NULL,
    profile_id TEXT NOT NULL DEFAULT 'pam-default',
    version UUID NOT NULL,
    profile JSONB NOT NULL,
    confidence JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pam_profiles_profile_id_chk CHECK (char_length(trim(profile_id)) BETWEEN 1 AND 128),
    CONSTRAINT pam_profiles_profile_json_chk CHECK (jsonb_typeof(profile) = 'object'),
    CONSTRAINT pam_profiles_confidence_json_chk CHECK (jsonb_typeof(confidence) = 'object')
);

COMMENT ON TABLE pam_profiles IS 'Per-subject autonomy profile capturing consent, spend, and escalation preferences.';
COMMENT ON COLUMN pam_profiles.subject_id IS 'Identity/subject the PAM profile belongs to (user-level UUID).';
COMMENT ON COLUMN pam_profiles.profile_id IS 'Logical profile identifier (e.g., pam-default).';
COMMENT ON COLUMN pam_profiles.version IS 'Server-assigned profile version UUID for optimistic concurrency.';
COMMENT ON COLUMN pam_profiles.profile IS 'JSON payload describing current autonomy preferences.';
COMMENT ON COLUMN pam_profiles.confidence IS 'Per-field confidence scores for learned autonomy settings.';
COMMENT ON COLUMN pam_profiles.created_at IS 'Timestamp when the profile row was first created.';
COMMENT ON COLUMN pam_profiles.updated_at IS 'Timestamp when the profile row was last updated.';

CREATE UNIQUE INDEX IF NOT EXISTS pam_profiles_subject_profile_idx
    ON pam_profiles (subject_id, profile_id);

CREATE INDEX IF NOT EXISTS pam_profiles_subject_updated_idx
    ON pam_profiles (subject_id, updated_at DESC);

ALTER TABLE pam_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY pam_profiles_rls_placeholder ON pam_profiles USING (true) WITH CHECK (true);
COMMENT ON POLICY pam_profiles_rls_placeholder ON pam_profiles IS 'TODO: scope PAM profile access by subject once authz is implemented.';

CREATE TABLE IF NOT EXISTS pvp_profiles (
    id BIGSERIAL PRIMARY KEY,
    subject_id UUID NOT NULL,
    profile_id TEXT NOT NULL DEFAULT 'pvp-default',
    version UUID NOT NULL,
    profile JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pvp_profiles_profile_id_chk CHECK (char_length(trim(profile_id)) BETWEEN 1 AND 128),
    CONSTRAINT pvp_profiles_profile_json_chk CHECK (jsonb_typeof(profile) = 'object')
);

COMMENT ON TABLE pvp_profiles IS 'Per-subject persona and voice preferences used when communicating with the user.';
COMMENT ON COLUMN pvp_profiles.subject_id IS 'Identity/subject the PVP profile belongs to.';
COMMENT ON COLUMN pvp_profiles.profile_id IS 'Logical profile identifier (e.g., pvp-default).';
COMMENT ON COLUMN pvp_profiles.version IS 'Server-assigned profile version UUID for optimistic concurrency.';
COMMENT ON COLUMN pvp_profiles.profile IS 'JSON payload containing tone, verbosity, initiative, and voice settings.';
COMMENT ON COLUMN pvp_profiles.created_at IS 'Timestamp when the profile row was first created.';
COMMENT ON COLUMN pvp_profiles.updated_at IS 'Timestamp when the profile row was last updated.';

CREATE UNIQUE INDEX IF NOT EXISTS pvp_profiles_subject_profile_idx
    ON pvp_profiles (subject_id, profile_id);

CREATE INDEX IF NOT EXISTS pvp_profiles_subject_updated_idx
    ON pvp_profiles (subject_id, updated_at DESC);

ALTER TABLE pvp_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY pvp_profiles_rls_placeholder ON pvp_profiles USING (true) WITH CHECK (true);
COMMENT ON POLICY pvp_profiles_rls_placeholder ON pvp_profiles IS 'TODO: scope PVP profile access by subject once authz is implemented.';
