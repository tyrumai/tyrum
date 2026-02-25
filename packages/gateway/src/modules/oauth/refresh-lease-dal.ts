import type { SqlDb } from "../../statestore/types.js";

export class OauthRefreshLeaseDal {
  constructor(private readonly db: SqlDb) {}

  async tryAcquire(input: {
    profileId: string;
    owner: string;
    nowMs: number;
    leaseTtlMs: number;
  }): Promise<boolean> {
    const leaseExpiresAt = input.nowMs + Math.max(1, input.leaseTtlMs);
    const inserted = await this.db.run(
      `INSERT INTO oauth_refresh_leases (profile_id, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT (profile_id) DO NOTHING`,
      [input.profileId, input.owner, leaseExpiresAt],
    );
    if (inserted.changes > 0) return true;

    const updated = await this.db.run(
      `UPDATE oauth_refresh_leases
       SET lease_owner = ?,
           lease_expires_at_ms = ?
       WHERE profile_id = ?
         AND lease_expires_at_ms <= ?`,
      [input.owner, leaseExpiresAt, input.profileId, input.nowMs],
    );

    return updated.changes > 0;
  }

  async release(input: { profileId: string; owner: string }): Promise<void> {
    await this.db.run(
      `DELETE FROM oauth_refresh_leases
       WHERE profile_id = ? AND lease_owner = ?`,
      [input.profileId, input.owner],
    );
  }
}
