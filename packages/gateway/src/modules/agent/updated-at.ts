import type { SqlDb } from "../../statestore/types.js";

export async function touchAgentUpdatedAt(
  db: SqlDb,
  params: { tenantId: string; agentId: string },
): Promise<void> {
  const result = await db.run(
    `UPDATE agents
     SET updated_at = CURRENT_TIMESTAMP
     WHERE tenant_id = ? AND agent_id = ?`,
    [params.tenantId, params.agentId],
  );

  if (result.changes < 1) {
    throw new Error("agent updated_at refresh failed");
  }
}
