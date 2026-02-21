import type { PolicyBundle as PolicyBundleT } from "@tyrum/schemas";
import { PolicyBundle } from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import { sha256HexFromString, stableJsonStringify } from "./canonical-json.js";

export interface PolicySnapshotRow {
  policy_snapshot_id: string;
  sha256: string;
  created_at: string;
  bundle: PolicyBundleT;
}

interface RawPolicySnapshotRow {
  policy_snapshot_id: string;
  sha256: string;
  bundle_json: string;
  created_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseBundle(raw: string): PolicyBundleT {
  try {
    return PolicyBundle.parse(JSON.parse(raw) as unknown);
  } catch {
    return PolicyBundle.parse({ v: 1 });
  }
}

function toRow(raw: RawPolicySnapshotRow): PolicySnapshotRow {
  return {
    policy_snapshot_id: raw.policy_snapshot_id,
    sha256: raw.sha256,
    created_at: normalizeTime(raw.created_at),
    bundle: parseBundle(raw.bundle_json),
  };
}

export class PolicySnapshotDal {
  constructor(private readonly db: SqlDb) {}

  async getById(policySnapshotId: string): Promise<PolicySnapshotRow | undefined> {
    const row = await this.db.get<RawPolicySnapshotRow>(
      `SELECT policy_snapshot_id, sha256, bundle_json, created_at
       FROM policy_snapshots
       WHERE policy_snapshot_id = ?`,
      [policySnapshotId],
    );
    return row ? toRow(row) : undefined;
  }

  async getBySha256(sha256: string): Promise<PolicySnapshotRow | undefined> {
    const row = await this.db.get<RawPolicySnapshotRow>(
      `SELECT policy_snapshot_id, sha256, bundle_json, created_at
       FROM policy_snapshots
       WHERE sha256 = ?`,
      [sha256],
    );
    return row ? toRow(row) : undefined;
  }

  async getOrCreate(bundle: PolicyBundleT): Promise<PolicySnapshotRow> {
    const canonicalJson = stableJsonStringify(bundle);
    const sha256 = sha256HexFromString(canonicalJson);

    const existing = await this.getBySha256(sha256);
    if (existing) return existing;

    const id = randomUUID();
    const row = await this.db.get<RawPolicySnapshotRow>(
      `INSERT INTO policy_snapshots (policy_snapshot_id, sha256, bundle_json)
       VALUES (?, ?, ?)
       RETURNING policy_snapshot_id, sha256, bundle_json, created_at`,
      [id, sha256, canonicalJson],
    );
    if (!row) {
      throw new Error("policy snapshot insert failed");
    }
    return toRow(row);
  }
}

