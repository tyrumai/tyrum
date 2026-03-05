import type { WsEventEnvelope, WsRequestEnvelope } from "@tyrum/schemas";
import type { SqlDb } from "../statestore/types.js";

export async function enqueueWsBroadcastMessage(
  db: SqlDb,
  tenantId: string,
  message: WsEventEnvelope | WsRequestEnvelope,
): Promise<void> {
  const normalizedTenantId = tenantId.trim();
  if (normalizedTenantId.length === 0) {
    throw new Error("tenantId is required");
  }

  await db.run(
    `INSERT INTO outbox (tenant_id, topic, target_edge_id, payload_json)
     VALUES (?, ?, ?, ?)`,
    [normalizedTenantId, "ws.broadcast", null, JSON.stringify({ message })],
  );
}
