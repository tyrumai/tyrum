import type { WsEventEnvelope } from "@tyrum/contracts";
import type { ProtocolDeps } from "./types.js";
import { broadcastEvent } from "./helpers.js";

/**
 * Broadcast a `plan_update` to all connected clients.
 */
export function sendPlanUpdate(
  tenantId: string,
  planId: string,
  status: string,
  deps: ProtocolDeps,
  detail?: string,
): void {
  const message: WsEventEnvelope = {
    event_id: crypto.randomUUID(),
    type: "plan.update",
    occurred_at: new Date().toISOString(),
    payload: {
      plan_id: planId,
      status,
      detail,
    },
  };
  broadcastEvent(tenantId, message, deps);
}
