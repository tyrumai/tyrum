import type { SqlDb } from "../../statestore/types.js";
import { ConversationQueueSignalDal } from "./queue-signal-dal.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";

export async function releaseConversationLease(
  db: SqlDb,
  opts: { tenant_id?: string; key: string; owner: string },
): Promise<void> {
  const tenantId = opts.tenant_id?.trim() || DEFAULT_TENANT_ID;
  await db.transaction(async (tx) => {
    const res = await tx.run(
      `DELETE FROM conversation_leases
       WHERE tenant_id = ? AND conversation_key = ? AND lease_owner = ?`,
      [tenantId, opts.key, opts.owner],
    );

    if (res.changes === 1) {
      const signals = new ConversationQueueSignalDal(tx);
      await signals.clearSignal({ tenant_id: tenantId, key: opts.key });
    }
  });
}
