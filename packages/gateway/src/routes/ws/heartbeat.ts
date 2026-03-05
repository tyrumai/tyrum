import type { PresenceDal } from "../../modules/presence/dal.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import { broadcastLocalEvent } from "./connection-support.js";
import type { WsClusterOptions } from "./types.js";

const HEARTBEAT_INTERVAL_MS = 5_000;

export interface HeartbeatControllerOptions {
  connectionManager: ConnectionManager;
  cluster?: WsClusterOptions;
  connectionTtlMs: number;
  presenceDal?: PresenceDal;
  presenceTtlMs: number;
  presenceMaxEntries: number;
}

export function createHeartbeatController(opts: HeartbeatControllerOptions): {
  stopHeartbeat: () => void;
} {
  const heartbeatTimer = setInterval(() => {
    opts.connectionManager.heartbeat();
    touchClusterConnections(opts);
    syncPresenceEntries(opts);
  }, HEARTBEAT_INTERVAL_MS);

  heartbeatTimer.unref();

  return {
    stopHeartbeat() {
      clearInterval(heartbeatTimer);
    },
  };
}

function touchClusterConnections(opts: HeartbeatControllerOptions): void {
  if (!opts.cluster) return;

  const nowMs = Date.now();
  for (const client of opts.connectionManager.allClients()) {
    const tenantId = client.auth_claims?.tenant_id;
    if (!tenantId) continue;
    void opts.cluster.connectionDirectory
      .touchConnection({
        tenantId,
        connectionId: client.id,
        nowMs,
        ttlMs: opts.connectionTtlMs,
      })
      .catch(() => {});
  }

  void opts.cluster.connectionDirectory.cleanupExpired(nowMs).catch(() => {});
}

function syncPresenceEntries(opts: HeartbeatControllerOptions): void {
  if (!opts.presenceDal) return;

  const nowMs = Date.now();
  for (const client of opts.connectionManager.allClients()) {
    if (!client.device_id) continue;
    void opts.presenceDal
      .touch({ instanceId: client.device_id, nowMs, ttlMs: opts.presenceTtlMs })
      .catch(() => {});
  }

  void opts.presenceDal
    .pruneExpired(nowMs)
    .then((pruned) => {
      for (const instanceId of pruned) {
        broadcastPresencePruned(opts.connectionManager, instanceId);
      }
    })
    .catch(() => {});

  void opts.presenceDal.enforceCap(opts.presenceMaxEntries).catch(() => {});
}

function broadcastPresencePruned(connectionManager: ConnectionManager, instanceId: string): void {
  const event = {
    event_id: crypto.randomUUID(),
    type: "presence.pruned",
    occurred_at: new Date().toISOString(),
    payload: { instance_id: instanceId },
  };
  broadcastLocalEvent(connectionManager, event);
}
