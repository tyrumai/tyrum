import type { NodePairingRequest, WsEventEnvelope } from "@tyrum/contracts";
import type { ConnectionDirectoryDal } from "../app/modules/backplane/connection-directory.js";
import type { OutboxDal } from "../app/modules/backplane/outbox-dal.js";
import type { Logger } from "../app/modules/observability/logger.js";
import type { ConnectionManager } from "./connection-manager.js";
import { safeSendWs } from "./safe-send.js";

export interface PairingApprovedDeliveryDeps {
  connectionManager: ConnectionManager;
  logger?: Logger;
  maxBufferedBytes?: number;
  cluster?: {
    edgeId: string;
    outboxDal: OutboxDal;
    connectionDirectory: ConnectionDirectoryDal;
  };
}

export function emitPairingApprovedEvent(
  deps: PairingApprovedDeliveryDeps,
  tenantId: string,
  input: { pairing: NodePairingRequest; nodeId: string; scopedToken: string },
): void {
  const normalizedTenantId = tenantId.trim();
  if (normalizedTenantId.length === 0) {
    throw new Error("tenantId is required");
  }

  const evt = {
    event_id: crypto.randomUUID(),
    type: "pairing.updated",
    occurred_at: new Date().toISOString(),
    payload: { pairing: input.pairing, scoped_token: input.scopedToken },
  } satisfies WsEventEnvelope;

  // Local, direct (do not broadcast tokens).
  const payload = JSON.stringify(evt);
  for (const client of deps.connectionManager.allClients()) {
    if (client.role !== "node") continue;
    if (client.device_id !== input.nodeId) continue;
    if (client.auth_claims?.tenant_id !== normalizedTenantId) continue;
    safeSendWs(client, payload, {
      connectionManager: deps.connectionManager,
      deliveryMode: "local_direct",
      logFields: {
        node_id: input.nodeId,
        peer_id: client.id,
      },
      logger: deps.logger,
      maxBufferedBytes: deps.maxBufferedBytes,
      sendFailureLogMessage: "ws.pairing_approved.delivery_failed",
      topic: evt.type,
    });
  }

  // Cluster, direct (best-effort).
  if (deps.cluster) {
    const cluster = deps.cluster;
    void (async () => {
      const nowMs = Date.now();
      const peers = await cluster.connectionDirectory.listNonExpired(normalizedTenantId, nowMs);
      for (const peer of peers) {
        if (peer.role !== "node") continue;
        if (peer.device_id !== input.nodeId) continue;
        if (peer.edge_id === cluster.edgeId) continue;
        await cluster.outboxDal.enqueue(
          normalizedTenantId,
          "ws.direct",
          { connection_id: peer.connection_id, message: evt },
          { targetEdgeId: peer.edge_id },
        );
      }
    })().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.warn("ws.pairing_approved.cluster_delivery_failed", {
        node_id: input.nodeId,
        error: message,
      });
    });
  }
}
