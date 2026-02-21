/**
 * Snapshot export — consistent transactional dump of durable tables.
 *
 * Excludes transient/operational tables (presence, outbox, connections,
 * leases, resume tokens, deduplication windows) which represent ephemeral
 * runtime state.
 */

import type { SqlDb } from "../../statestore/types.js";

/** Tables included in the snapshot export, in dependency order. */
const DURABLE_TABLES = [
  "sessions",
  "facts",
  "episodic_events",
  "capability_memories",
  "vector_metadata",
  "pam_profiles",
  "pvp_profiles",
  "planner_events",
  "approvals",
  "watchers",
  "canvas_artifacts",
  "execution_jobs",
  "execution_runs",
  "execution_steps",
  "execution_attempts",
  "artifact_metadata",
  "nodes",
  "node_capabilities",
  "policy_snapshots",
  "model_auth_profiles",
  "context_reports",
] as const;

export interface SnapshotBundle {
  version: 1;
  exported_at: string;
  db_kind: string;
  tables: Record<string, unknown[]>;
}

export async function exportSnapshot(db: SqlDb): Promise<SnapshotBundle> {
  return await db.transaction(async (tx) => {
    const tables: Record<string, unknown[]> = {};

    for (const table of DURABLE_TABLES) {
      try {
        tables[table] = await tx.all(`SELECT * FROM ${table}`, []);
      } catch {
        // Table may not exist yet if migrations are partial — skip gracefully
        tables[table] = [];
      }
    }

    return {
      version: 1,
      exported_at: new Date().toISOString(),
      db_kind: db.kind,
      tables,
    };
  });
}

export function getExportedTableNames(): readonly string[] {
  return DURABLE_TABLES;
}
