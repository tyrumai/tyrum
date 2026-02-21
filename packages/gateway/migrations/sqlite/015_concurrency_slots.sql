-- Concurrency slots (global/per-agent/per-capability) for execution attempts.
--
-- Slots are durable rows keyed by (scope, scope_id, slot). A worker claims an
-- available slot by setting (lease_owner, lease_expires_at_ms, attempt_id).
-- Expired leases are treated as free, enabling safe takeover under crashes.

CREATE TABLE IF NOT EXISTS concurrency_slots (
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  attempt_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (scope, scope_id, slot)
);

CREATE INDEX IF NOT EXISTS concurrency_slots_lease_idx ON concurrency_slots (scope, scope_id, lease_expires_at_ms);
CREATE INDEX IF NOT EXISTS concurrency_slots_attempt_idx ON concurrency_slots (attempt_id);
