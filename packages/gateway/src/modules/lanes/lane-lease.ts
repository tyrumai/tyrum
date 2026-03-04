import type { SqlDb } from "../../statestore/types.js";
import { LaneQueueSignalDal } from "./queue-signal-dal.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";

export async function releaseLaneLease(
  db: SqlDb,
  opts: { tenant_id?: string; key: string; lane: string; owner: string },
): Promise<void> {
  const tenantId = opts.tenant_id?.trim() || DEFAULT_TENANT_ID;
  await db.transaction(async (tx) => {
    const res = await tx.run(
      `DELETE FROM lane_leases
       WHERE tenant_id = ? AND key = ? AND lane = ? AND lease_owner = ?`,
      [tenantId, opts.key, opts.lane, opts.owner],
    );

    if (res.changes === 1) {
      const signals = new LaneQueueSignalDal(tx);
      await signals.clearSignal({ tenant_id: tenantId, key: opts.key, lane: opts.lane });
    }
  });
}
