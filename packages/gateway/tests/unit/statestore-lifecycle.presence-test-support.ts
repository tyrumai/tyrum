import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { SqlDb } from "../../src/statestore/types.js";
import type { LifecycleTestClock } from "./statestore-lifecycle.test-support.js";

export async function seedPresenceEntries(db: SqlDb, now: LifecycleTestClock): Promise<void> {
  await db.run(
    `INSERT INTO presence_entries (
       tenant_id,
       instance_id,
       role,
       connection_id,
       host,
       ip,
       version,
       mode,
       last_input_seconds,
       metadata_json,
       connected_at_ms,
       last_seen_at_ms,
       expires_at_ms,
       updated_at
     )
     VALUES (?, ?, 'client', NULL, NULL, NULL, NULL, NULL, NULL, '{}', ?, ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      "presence-expired",
      now.nowMs - 10_000,
      now.nowMs - 10_000,
      now.nowMs - 1,
      now.nowIso,
    ],
  );
  await db.run(
    `INSERT INTO presence_entries (
       tenant_id,
       instance_id,
       role,
       connection_id,
       host,
       ip,
       version,
       mode,
       last_input_seconds,
       metadata_json,
       connected_at_ms,
       last_seen_at_ms,
       expires_at_ms,
       updated_at
     )
     VALUES (?, ?, 'client', NULL, NULL, NULL, NULL, NULL, NULL, '{}', ?, ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      "presence-fresh",
      now.nowMs - 10_000,
      now.nowMs - 10_000,
      now.nowMs + 60_000,
      now.nowIso,
    ],
  );
}
