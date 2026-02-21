/**
 * Data access layer for policy snapshots — stores the effective
 * policy bundle state at the time of each execution run.
 */

import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";

export interface PolicySnapshotRow {
  snapshot_id: string;
  run_id: string;
  bundle_json: string;
  created_at: string;
}

export class PolicySnapshotDal {
  constructor(private readonly db: SqlDb) {}

  async createSnapshot(
    runId: string,
    bundleState: unknown,
  ): Promise<PolicySnapshotRow> {
    const snapshotId = randomUUID();
    const bundleJson = JSON.stringify(bundleState);
    const row = await this.db.get<PolicySnapshotRow>(
      `INSERT INTO policy_snapshots (snapshot_id, run_id, bundle_json)
       VALUES (?, ?, ?)
       RETURNING *`,
      [snapshotId, runId, bundleJson],
    );
    if (!row) throw new Error("snapshot insert failed");
    return row;
  }

  async getByRunId(runId: string): Promise<PolicySnapshotRow | undefined> {
    return await this.db.get<PolicySnapshotRow>(
      "SELECT * FROM policy_snapshots WHERE run_id = ?",
      [runId],
    );
  }

  async getBySnapshotId(
    snapshotId: string,
  ): Promise<PolicySnapshotRow | undefined> {
    return await this.db.get<PolicySnapshotRow>(
      "SELECT * FROM policy_snapshots WHERE snapshot_id = ?",
      [snapshotId],
    );
  }
}
