/**
 * WebSocket upgrade handler.
 *
 * Uses the `ws` library to accept upgrade requests, authenticate via token,
 * wait for the initial `hello` handshake, and then wire all subsequent
 * messages through the protocol dispatcher.
 */

import { WebSocketServer } from "ws";
import { createTrustedProxyAllowlistFromEnv } from "../modules/auth/client-ip.js";
import { selectWsSubprotocol } from "./ws/auth.js";
import { bindWsConnectionHandler } from "./ws/connection-handler.js";
import { createHeartbeatController } from "./ws/heartbeat.js";
import type { WsRouteOptions } from "./ws/types.js";
import { createHandleUpgrade } from "./ws/upgrade.js";

export type { WsRouteOptions } from "./ws/types.js";

/**
 * Create a `WebSocketServer` and wire up the connection lifecycle.
 *
 * Call `handleUpgrade` from an HTTP server's `"upgrade"` event to route
 * WebSocket connections into this handler.
 */
export function createWsHandler(opts: WsRouteOptions): {
  wss: WebSocketServer;
  handleUpgrade: ReturnType<typeof createHandleUpgrade>;
  stopHeartbeat: () => void;
} {
  const trustedProxies = opts.upgradeRateLimiter
    ? createTrustedProxyAllowlistFromEnv(opts.trustedProxies)
    : undefined;
  const connectionTtlMs = opts.cluster?.connectionTtlMs ?? 30_000;
  const presenceTtlMs = opts.presence?.ttlMs ?? 60_000;
  const presenceMaxEntries = opts.presence?.maxEntries ?? 500;

  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => selectWsSubprotocol(protocols),
  });

  const { stopHeartbeat } = createHeartbeatController({
    connectionManager: opts.connectionManager,
    cluster: opts.cluster,
    connectionTtlMs,
    presenceDal: opts.presenceDal,
    presenceTtlMs,
    presenceMaxEntries,
  });

  bindWsConnectionHandler({
    wss,
    connectionManager: opts.connectionManager,
    protocolDeps: opts.protocolDeps,
    authTokens: opts.authTokens,
    cluster: opts.cluster,
    connectionTtlMs,
    presenceDal: opts.presenceDal,
    nodePairingDal: opts.nodePairingDal,
    presenceTtlMs,
  });

  const handleUpgrade = createHandleUpgrade({
    wss,
    upgradeRateLimiter: opts.upgradeRateLimiter,
    trustedProxies,
  });

  return { wss, handleUpgrade, stopHeartbeat };
}
