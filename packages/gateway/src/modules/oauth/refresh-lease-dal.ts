import type { SqlDb } from "../../statestore/types.js";

export class OauthRefreshLeaseDal {
  constructor(private readonly db: SqlDb) {}

  async tryAcquire(input: {
    tenantId: string;
    authProfileId: string;
    owner: string;
    nowMs: number;
    leaseTtlMs: number;
  }): Promise<boolean> {
    const leaseExpiresAt = input.nowMs + Math.max(1, input.leaseTtlMs);
    const inserted = await this.db.run(
      `INSERT INTO oauth_refresh_leases (tenant_id, auth_profile_id, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (tenant_id, auth_profile_id) DO NOTHING`,
      [input.tenantId, input.authProfileId, input.owner, leaseExpiresAt],
    );
    if (inserted.changes > 0) return true;

    const updated = await this.db.run(
      `UPDATE oauth_refresh_leases
       SET lease_owner = ?,
           lease_expires_at_ms = ?
       WHERE tenant_id = ?
         AND auth_profile_id = ?
         AND lease_expires_at_ms <= ?`,
      [input.owner, leaseExpiresAt, input.tenantId, input.authProfileId, input.nowMs],
    );

    return updated.changes > 0;
  }

  async release(input: { tenantId: string; authProfileId: string; owner: string }): Promise<void> {
    await this.db.run(
      `DELETE FROM oauth_refresh_leases
       WHERE tenant_id = ? AND auth_profile_id = ? AND lease_owner = ?`,
      [input.tenantId, input.authProfileId, input.owner],
    );
  }
}
