import type { SqlDb } from "../../statestore/types.js";

export interface ModelsDevRefreshLeaseRow {
  key: string;
  lease_owner: string;
  lease_expires_at_ms: number;
}

interface RawModelsDevRefreshLeaseRow {
  key: string;
  lease_owner: string;
  lease_expires_at_ms: number;
}

function toRow(raw: RawModelsDevRefreshLeaseRow): ModelsDevRefreshLeaseRow {
  return {
    key: raw.key,
    lease_owner: raw.lease_owner,
    lease_expires_at_ms: raw.lease_expires_at_ms,
  };
}

export class ModelsDevRefreshLeaseDal {
  constructor(private readonly db: SqlDb) {}

  async get(key: string): Promise<ModelsDevRefreshLeaseRow | undefined> {
    const row = await this.db.get<RawModelsDevRefreshLeaseRow>(
      "SELECT * FROM models_dev_refresh_leases WHERE key = ?",
      [key],
    );
    return row ? toRow(row) : undefined;
  }

  async tryAcquire(input: { key: string; owner: string; nowMs: number; leaseTtlMs: number }): Promise<boolean> {
    const leaseExpiresAt = input.nowMs + Math.max(1, input.leaseTtlMs);
    const inserted = await this.db.run(
      `INSERT INTO models_dev_refresh_leases (key, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT (key) DO NOTHING`,
      [input.key, input.owner, leaseExpiresAt],
    );

    if (inserted.changes > 0) return true;

    const updated = await this.db.run(
      `UPDATE models_dev_refresh_leases
       SET lease_owner = ?,
           lease_expires_at_ms = ?
       WHERE key = ?
         AND (lease_expires_at_ms <= ? OR lease_owner = ?)`,
      [input.owner, leaseExpiresAt, input.key, input.nowMs, input.owner],
    );

    return updated.changes > 0;
  }

  async release(input: { key: string; owner: string }): Promise<void> {
    await this.db.run(
      `DELETE FROM models_dev_refresh_leases
       WHERE key = ? AND lease_owner = ?`,
      [input.key, input.owner],
    );
  }
}

