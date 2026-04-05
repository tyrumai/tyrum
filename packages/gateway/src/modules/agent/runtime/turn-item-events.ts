import type { WsEventEnvelope as WsEventEnvelopeT } from "@tyrum/contracts";
import type { TurnItem } from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import { enqueueWsBroadcastMessage } from "../../../ws/outbox.js";
import type { SqlDb } from "../../../statestore/types.js";

export async function emitTurnItemCreatedTx(
  tx: SqlDb,
  input: {
    tenantId: string;
    turnItem: TurnItem;
  },
): Promise<void> {
  const tenantId = input.tenantId.trim();
  if (tenantId.length === 0) {
    throw new Error("tenantId is required");
  }

  const event: WsEventEnvelopeT = {
    event_id: randomUUID(),
    type: "turn.item.created",
    occurred_at: input.turnItem.created_at,
    scope: { kind: "turn", turn_id: input.turnItem.turn_id },
    payload: {
      turn_item: input.turnItem,
    },
  };

  await enqueueWsBroadcastMessage(tx, tenantId, event);
}
