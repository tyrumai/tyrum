-- Waitlist signups with campaign context for the Tyrum landing page.
CREATE TABLE IF NOT EXISTS waitlist_signups (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_term TEXT,
    utm_content TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (length(trim(email)) > 0)
);

COMMENT ON TABLE waitlist_signups IS 'Captured waitlist signups from the public landing page.';
COMMENT ON COLUMN waitlist_signups.email IS 'Email address submitted via the landing page call to action.';
COMMENT ON COLUMN waitlist_signups.utm_source IS 'UTM source parameter supplied with the signup event, if any.';
COMMENT ON COLUMN waitlist_signups.utm_medium IS 'UTM medium parameter supplied with the signup event, if any.';
COMMENT ON COLUMN waitlist_signups.utm_campaign IS 'UTM campaign parameter supplied with the signup event, if any.';
COMMENT ON COLUMN waitlist_signups.utm_term IS 'UTM term parameter supplied with the signup event, if any.';
COMMENT ON COLUMN waitlist_signups.utm_content IS 'UTM content parameter supplied with the signup event, if any.';
COMMENT ON COLUMN waitlist_signups.created_at IS 'Timestamp when the waitlist entry was created.';

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_signups_email_unique
    ON waitlist_signups ((LOWER(email)));
