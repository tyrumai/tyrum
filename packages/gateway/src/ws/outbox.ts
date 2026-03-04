import type { WsEventEnvelope, WsRequestEnvelope } from "@tyrum/schemas";
import type { SqlDb } from "../statestore/types.js";
import { DEFAULT_TENANT_ID } from "../modules/identity/scope.js";

export async function enqueueWsBroadcastMessage(
  db: SqlDb,
  message: WsEventEnvelope | WsRequestEnvelope,
): Promise<void> {
  await db.run(
    `INSERT INTO outbox (tenant_id, topic, target_edge_id, payload_json)
     VALUES (?, ?, ?, ?)`,
    [DEFAULT_TENANT_ID, "ws.broadcast", null, JSON.stringify({ message })],
  );
}
