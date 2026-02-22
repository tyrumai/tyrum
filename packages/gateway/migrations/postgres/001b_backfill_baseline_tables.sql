-- Backfill tables that were added to the 001_init.sql baseline after some
-- deployments had already applied it.
--
-- Migrations are tracked by filename in the `_migrations` table. If a database
-- already recorded `001_init.sql`, it will not be re-applied when the baseline
-- changes, leaving newer baseline-only tables missing and causing later
-- incremental migrations (and runtime queries) to fail.

--------------------------------------------------------------------------------
-- presence_entries
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS presence_entries (
  client_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'client',
  node_id TEXT,
  agent_id TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata_json TEXT
);

--------------------------------------------------------------------------------
-- artifact_metadata
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifact_metadata (
  artifact_id TEXT PRIMARY KEY,
  run_id TEXT,
  step_id TEXT,
  attempt_id TEXT,
  kind TEXT NOT NULL DEFAULT 'other',
  mime_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  uri TEXT NOT NULL,
  labels_json TEXT NOT NULL DEFAULT '[]',
  agent_id TEXT NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_artifact_metadata_run_id ON artifact_metadata (run_id);
CREATE INDEX IF NOT EXISTS idx_artifact_metadata_step_id ON artifact_metadata (step_id);
CREATE INDEX IF NOT EXISTS idx_artifact_metadata_agent ON artifact_metadata (agent_id);
CREATE INDEX IF NOT EXISTS idx_artifact_metadata_created_at ON artifact_metadata (created_at);

--------------------------------------------------------------------------------
-- nodes
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nodes (
  node_id TEXT PRIMARY KEY,
  label TEXT,
  capabilities JSONB NOT NULL DEFAULT '[]',
  pairing_status TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  resolution_reason TEXT,
  last_seen_at TIMESTAMPTZ,
  metadata JSONB
);

--------------------------------------------------------------------------------
-- node_capabilities
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS node_capabilities (
  node_id TEXT NOT NULL REFERENCES nodes(node_id),
  capability TEXT NOT NULL,
  PRIMARY KEY (node_id, capability)
);

--------------------------------------------------------------------------------
-- inbound_dedupe
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inbound_dedupe (
  message_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (message_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_inbound_dedupe_expires ON inbound_dedupe (expires_at);

--------------------------------------------------------------------------------
-- outbound_idempotency
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbound_idempotency (
  idempotency_key TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  result_json JSONB,
  PRIMARY KEY (idempotency_key, channel)
);

--------------------------------------------------------------------------------
-- policy_snapshots
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS policy_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  bundle_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_snapshots_run_id ON policy_snapshots (run_id);

--------------------------------------------------------------------------------
-- model_auth_profiles
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS model_auth_profiles (
  profile_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT,
  secret_handle TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0,
  agent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_model_auth_profiles_provider ON model_auth_profiles (provider);
CREATE INDEX IF NOT EXISTS idx_auth_profiles_agent ON model_auth_profiles (agent_id);

--------------------------------------------------------------------------------
-- context_reports
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS context_reports (
  report_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  report_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_context_reports_run_id ON context_reports (run_id);

--------------------------------------------------------------------------------
-- policy_overrides
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS policy_overrides (
  policy_override_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  agent_id TEXT NOT NULL,
  workspace_id TEXT,
  tool_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  created_from_approval_id INTEGER,
  created_from_policy_snapshot_id TEXT,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_policy_overrides_agent_tool ON policy_overrides (agent_id, tool_id, status);

--------------------------------------------------------------------------------
-- watcher_firings
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watcher_firings (
  firing_id TEXT PRIMARY KEY,
  watcher_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'enqueued', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (watcher_id) REFERENCES watchers(id)
);

