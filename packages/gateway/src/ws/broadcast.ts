import type { WsEventEnvelope } from "@tyrum/schemas";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { ConnectionManager } from "./connection-manager.js";
import { shouldDeliverToWsAudience, type WsBroadcastAudience } from "./audience.js";

export interface WsBroadcastClusterDeps {
  edgeId: string;
  outboxDal: OutboxDal;
}

export function broadcastWsEvent(
  tenantId: string,
  evt: WsEventEnvelope,
  deps: { connectionManager: ConnectionManager; cluster?: WsBroadcastClusterDeps },
  audience?: WsBroadcastAudience,
): void {
  const normalizedTenantId = tenantId.trim();
  if (normalizedTenantId.length === 0) {
    throw new Error("tenantId is required");
  }

  const payload = JSON.stringify(evt);
  for (const peer of deps.connectionManager.allClients()) {
    if (peer.auth_claims?.tenant_id !== normalizedTenantId) continue;
    if (!shouldDeliverToWsAudience(peer, audience)) continue;
    try {
      peer.ws.send(payload);
    } catch (_err) {
      void _err;
      // Intentional: broadcast delivery is best-effort; peers may disconnect during send.
    }
  }
  if (deps.cluster) {
    void deps.cluster.outboxDal
      .enqueue(normalizedTenantId, "ws.broadcast", {
        source_edge_id: deps.cluster.edgeId,
        skip_local: true,
        message: evt,
        ...(audience ? { audience } : {}),
      })
      .catch((_err) => {
        void _err;
        // Intentional: cluster broadcast enqueue is best-effort; failures may drop this event for remote peers.
      });
  }
}
