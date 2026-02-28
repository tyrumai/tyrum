-- Peer identity links (Postgres)
--
-- Maps provider-native peer identifiers to a canonical peer id so DM sessions
-- can be shared across channels when using dm_scope=per_peer.

CREATE TABLE IF NOT EXISTS peer_identity_links (
  channel TEXT NOT NULL,
  account TEXT NOT NULL,
  provider_peer_id TEXT NOT NULL,
  canonical_peer_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT peer_identity_links_pk PRIMARY KEY (channel, account, provider_peer_id)
);

CREATE INDEX IF NOT EXISTS peer_identity_links_canonical_peer_id_idx
  ON peer_identity_links (canonical_peer_id);

