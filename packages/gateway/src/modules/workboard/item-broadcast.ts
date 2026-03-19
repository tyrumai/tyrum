import type { WorkItem } from "@tyrum/contracts";
import { broadcastWsEvent } from "../../ws/broadcast.js";
import type { ProtocolDeps } from "../../ws/protocol.js";
import { WORKBOARD_WS_AUDIENCE } from "../../ws/workboard-audience.js";

export type WorkboardBroadcastDeps = Pick<
  ProtocolDeps,
  "connectionManager" | "cluster" | "logger" | "maxBufferedBytes"
>;

export function broadcastWorkItemCreated(input: {
  item: WorkItem;
  deps?: WorkboardBroadcastDeps;
}): void {
  if (!input.deps) {
    return;
  }

  broadcastWsEvent(
    input.item.tenant_id,
    {
      event_id: crypto.randomUUID(),
      type: "work.item.created",
      occurred_at: new Date().toISOString(),
      scope: { kind: "agent", agent_id: input.item.agent_id },
      payload: { item: input.item },
    },
    {
      connectionManager: input.deps.connectionManager,
      cluster: input.deps.cluster,
      logger: input.deps.logger,
      maxBufferedBytes: input.deps.maxBufferedBytes,
    },
    WORKBOARD_WS_AUDIENCE,
  );
}
