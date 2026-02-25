import type { SqlDb } from "../../statestore/types.js";
import { LaneQueueSignalDal } from "./queue-signal-dal.js";

export async function releaseLaneLease(
  db: SqlDb,
  opts: { key: string; lane: string; owner: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const res = await tx.run(
      `DELETE FROM lane_leases
       WHERE key = ? AND lane = ? AND lease_owner = ?`,
      [opts.key, opts.lane, opts.owner],
    );

    if (res.changes === 1) {
      const signals = new LaneQueueSignalDal(tx);
      await signals.clearSignal({ key: opts.key, lane: opts.lane });
    }
  });
}
