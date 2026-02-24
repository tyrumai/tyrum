import type { WsEventEnvelope, WsRequestEnvelope } from "@tyrum/schemas";
import type { SqlDb } from "../statestore/types.js";

export async function enqueueWsBroadcastMessage(
  db: SqlDb,
  message: WsEventEnvelope | WsRequestEnvelope,
): Promise<void> {
  await db.run(
    `INSERT INTO outbox (topic, target_edge_id, payload_json)
     VALUES (?, ?, ?)`,
    ["ws.broadcast", null, JSON.stringify({ message })],
  );
}

