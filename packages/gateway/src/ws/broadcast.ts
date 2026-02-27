import type { WsEventEnvelope } from "@tyrum/schemas";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { ConnectionManager } from "./connection-manager.js";
import { shouldDeliverToWsAudience, type WsBroadcastAudience } from "./audience.js";

export interface WsBroadcastClusterDeps {
  edgeId: string;
  outboxDal: OutboxDal;
}

export function broadcastWsEvent(
  evt: WsEventEnvelope,
  deps: { connectionManager: ConnectionManager; cluster?: WsBroadcastClusterDeps },
  audience?: WsBroadcastAudience,
): void {
  const payload = JSON.stringify(evt);
  for (const peer of deps.connectionManager.allClients()) {
    if (!shouldDeliverToWsAudience(peer, audience)) continue;
    try {
      peer.ws.send(payload);
    } catch {
      // ignore
    }
  }
  if (deps.cluster) {
    void deps.cluster.outboxDal
      .enqueue("ws.broadcast", {
        source_edge_id: deps.cluster.edgeId,
        skip_local: true,
        message: evt,
        ...(audience ? { audience } : {}),
      })
      .catch(() => {
        // ignore
      });
  }
}

