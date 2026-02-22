CREATE TABLE IF NOT EXISTS oauth_pending (
  state TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  pkce_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scopes TEXT NOT NULL,
  mode TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_refresh_leases (
  profile_id TEXT PRIMARY KEY,
  lease_owner TEXT NOT NULL,
  lease_expires_at_ms BIGINT NOT NULL
);

