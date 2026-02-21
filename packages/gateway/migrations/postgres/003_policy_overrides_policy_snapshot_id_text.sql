-- policy_overrides.created_from_policy_snapshot_id should reference policy_snapshots.snapshot_id (UUID text).

ALTER TABLE policy_overrides
  ALTER COLUMN created_from_policy_snapshot_id
  TYPE TEXT;
