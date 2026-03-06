CREATE INDEX IF NOT EXISTS presence_entries_expires_prune_idx
ON presence_entries (expires_at_ms, instance_id);

CREATE INDEX IF NOT EXISTS lane_leases_prune_idx
ON lane_leases (lease_expires_at_ms, tenant_id, key, lane);

CREATE INDEX IF NOT EXISTS workspace_leases_prune_idx
ON workspace_leases (lease_expires_at_ms, tenant_id, workspace_id);

CREATE INDEX IF NOT EXISTS oauth_pending_expires_prune_idx
ON oauth_pending (expires_at, tenant_id, state);

CREATE INDEX IF NOT EXISTS oauth_refresh_leases_prune_idx
ON oauth_refresh_leases (lease_expires_at_ms, tenant_id, auth_profile_id);

CREATE INDEX IF NOT EXISTS models_dev_refresh_leases_prune_idx
ON models_dev_refresh_leases (lease_expires_at_ms, key);
