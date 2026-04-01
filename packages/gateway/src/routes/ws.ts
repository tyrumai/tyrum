/**
 * WebSocket upgrade handler.
 *
 * Uses the `ws` library to accept upgrade requests, authenticate via token,
 * wait for the initial `hello` handshake, and then wire all subsequent
 * messages through the protocol dispatcher.
 */

import { WebSocket, WebSocketServer } from "ws";
import { createTrustedProxyAllowlistFromEnv } from "../app/modules/auth/client-ip.js";
import { selectWsSubprotocol } from "./ws/auth.js";
import { bindWsConnectionHandler } from "./ws/connection-handler.js";
import { createHeartbeatController } from "./ws/heartbeat.js";
import type { WsRouteOptions } from "./ws/types.js";
import { createHandleUpgrade } from "./ws/upgrade.js";

export type { WsRouteOptions } from "./ws/types.js";

const WS_SHUTDOWN_CLOSE_CODE = 1001;
const WS_SHUTDOWN_CLOSE_REASON = "server shutdown";
const WS_SHUTDOWN_TERMINATE_GRACE_MS = 250;

function closeWebSocketServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    for (const client of wss.clients) {
      try {
        if (client.readyState === WebSocket.CLOSING || client.readyState === WebSocket.CLOSED) {
          continue;
        }
        client.close(WS_SHUTDOWN_CLOSE_CODE, WS_SHUTDOWN_CLOSE_REASON);
      } catch (closeError) {
        void closeError;
        try {
          client.terminate();
        } catch (terminateError) {
          void terminateError;
          // Best-effort shutdown: `wss.close()` will finish once the socket is gone.
        }
      }
    }

    const terminateTimer = setTimeout(() => {
      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch (terminateError) {
          void terminateError;
          // Intentional: the server is already shutting down.
        }
      }
    }, WS_SHUTDOWN_TERMINATE_GRACE_MS);
    terminateTimer.unref();

    try {
      wss.close(() => {
        clearTimeout(terminateTimer);
        resolve();
      });
    } catch (closeError) {
      void closeError;
      clearTimeout(terminateTimer);
      resolve();
    }
  });
}

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
  close: () => Promise<void>;
} {
  const trustedProxies = createTrustedProxyAllowlistFromEnv(opts.trustedProxies);
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
    trustedProxies,
    presenceDal: opts.presenceDal,
    nodePairingDal: opts.nodePairingDal,
    desktopEnvironmentDal: opts.desktopEnvironmentDal,
    presenceTtlMs,
  });

  const handleUpgrade = createHandleUpgrade({
    wss,
    upgradeRateLimiter: opts.upgradeRateLimiter,
    trustedProxies,
  });

  return {
    wss,
    handleUpgrade,
    stopHeartbeat,
    close: async () => await closeWebSocketServer(wss),
  };
}
