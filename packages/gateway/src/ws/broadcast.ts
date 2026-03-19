import type { WsEventEnvelope } from "@tyrum/contracts";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { Logger } from "../modules/observability/logger.js";
import type { MetricsRegistry } from "../modules/observability/metrics.js";
import type { ConnectionManager } from "./connection-manager.js";
import { shouldDeliverToWsAudience, type WsBroadcastAudience } from "./audience.js";
import { safeSendWs } from "./safe-send.js";

export interface WsBroadcastClusterDeps {
  edgeId: string;
  outboxDal: OutboxDal;
}

export interface WsBroadcastDeps {
  connectionManager: ConnectionManager;
  cluster?: WsBroadcastClusterDeps;
  logger?: Logger;
  metrics?: MetricsRegistry;
  maxBufferedBytes?: number;
}

export function broadcastWsEvent(
  tenantId: string,
  evt: WsEventEnvelope,
  deps: WsBroadcastDeps,
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
    safeSendWs(peer, payload, {
      connectionManager: deps.connectionManager,
      deliveryMode: "local_broadcast",
      logger: deps.logger,
      maxBufferedBytes: deps.maxBufferedBytes,
      metrics: deps.metrics,
      topic: "ws.broadcast",
    });
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
