-- Account linking preference toggles persisted for portal placeholder integrations.
CREATE TABLE IF NOT EXISTS account_link_preferences (
    account_id TEXT NOT NULL,
    integration_slug TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_id, integration_slug),
    CHECK (char_length(trim(account_id)) > 0),
    CHECK (char_length(trim(integration_slug)) > 0)
);

COMMENT ON TABLE account_link_preferences IS 'Preferred integration toggle states per account for the portal linking surface.';
COMMENT ON COLUMN account_link_preferences.account_id IS 'Synthetic portal account identifier tied to the current session.';
COMMENT ON COLUMN account_link_preferences.integration_slug IS 'Identifier of the integration being toggled (e.g. calendar, email).';
COMMENT ON COLUMN account_link_preferences.enabled IS 'Flag indicating whether the integration should be considered linked/enabled.';
COMMENT ON COLUMN account_link_preferences.created_at IS 'Timestamp when the preference row was created.';
COMMENT ON COLUMN account_link_preferences.updated_at IS 'Timestamp when the preference row was last updated.';

CREATE INDEX IF NOT EXISTS account_link_preferences_integration_idx
    ON account_link_preferences (integration_slug);
