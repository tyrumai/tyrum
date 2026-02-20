/**
 * WebSocket upgrade handler.
 *
 * Uses the `ws` library to accept upgrade requests, authenticate via token,
 * wait for the initial `hello` handshake, and then wire all subsequent
 * messages through the protocol dispatcher.
 */

import { WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WsConnectRequest, type WsResponseEnvelope } from "@tyrum/schemas";
import type { ConnectionManager } from "../ws/connection-manager.js";
import { validateWsToken } from "../ws/auth.js";
import { handleClientMessage } from "../ws/protocol.js";
import type { ProtocolDeps } from "../ws/protocol.js";
import type { TokenStore } from "../modules/auth/token-store.js";
import type { ConnectionDirectoryDal } from "../modules/backplane/connection-directory.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Interval between heartbeat ticks (milliseconds). */
const HEARTBEAT_INTERVAL_MS = 5_000;
const WS_BASE_PROTOCOL = "tyrum-v1";
const WS_AUTH_PROTOCOL_PREFIX = "tyrum-auth.";

function parseProtocolHeader(
  value: string | string[] | undefined,
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      entry
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    );
  }
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function decodeBase64Url(input: string): string | undefined {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padding);
    const decoded = Buffer.from(padded, "base64").toString("utf-8");
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function extractWsTokenFromProtocols(req: IncomingMessage): string | undefined {
  const offered = parseProtocolHeader(req.headers["sec-websocket-protocol"]);
  for (const protocol of offered) {
    if (!protocol.startsWith(WS_AUTH_PROTOCOL_PREFIX)) continue;
    const encodedToken = protocol.slice(WS_AUTH_PROTOCOL_PREFIX.length);
    const decoded = decodeBase64Url(encodedToken);
    if (decoded) return decoded;
  }
  return undefined;
}

function selectWsSubprotocol(protocols: Set<string>): string | false {
  if (protocols.has(WS_BASE_PROTOCOL)) return WS_BASE_PROTOCOL;
  for (const protocol of protocols) {
    if (!protocol.startsWith(WS_AUTH_PROTOCOL_PREFIX)) {
      return protocol;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export interface WsRouteOptions {
  connectionManager: ConnectionManager;
  protocolDeps: ProtocolDeps;
  tokenStore: TokenStore;
  cluster?: {
    instanceId: string;
    connectionDirectory: ConnectionDirectoryDal;
    connectionTtlMs?: number;
  };
}

/**
 * Create a `WebSocketServer` and wire up the connection lifecycle.
 *
 * Call `handleUpgrade` from an HTTP server's `"upgrade"` event to route
 * WebSocket connections into this handler.
 */
export function createWsHandler(opts: WsRouteOptions): {
  wss: WebSocketServer;
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  stopHeartbeat: () => void;
} {
  const { connectionManager, protocolDeps, tokenStore } = opts;
  const cluster = opts.cluster;
  const connectionTtlMs = cluster?.connectionTtlMs ?? 30_000;

  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => selectWsSubprotocol(protocols),
  });

  // --- heartbeat timer ---
  const heartbeatTimer = setInterval(() => {
    connectionManager.heartbeat();
    if (cluster) {
      const nowMs = Date.now();
      for (const client of connectionManager.allClients()) {
        cluster.connectionDirectory.touchConnection({
          connectionId: client.id,
          nowMs,
          ttlMs: connectionTtlMs,
        });
      }
      cluster.connectionDirectory.cleanupExpired(nowMs);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Prevent the timer from keeping the process alive.
  heartbeatTimer.unref();

  function stopHeartbeat(): void {
    clearInterval(heartbeatTimer);
  }

  // --- connection handler ---
  wss.on("connection", (ws, req) => {
    const token = extractWsTokenFromProtocols(req);

    if (!validateWsToken(token, tokenStore)) {
      ws.close(4001, "unauthorized");
      return;
    }

    // Mutable slot: filled once the hello handshake completes.
    let clientId: string | undefined;

    const helloTimeout = setTimeout(() => {
      if (clientId === undefined) {
        ws.close(4002, "hello timeout");
      }
    }, 5_000);

    ws.on("message", (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf-8");

      if (clientId === undefined) {
        // First message must be `connect`.
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          ws.close(4003, "invalid json");
          return;
        }

        const parsed = WsConnectRequest.safeParse(json);
        if (!parsed.success) {
          ws.close(4003, "expected connect request");
          return;
        }

        clearTimeout(helloTimeout);
        clientId = connectionManager.addClient(ws, parsed.data.payload.capabilities);
        if (cluster) {
          const nowMs = Date.now();
          cluster.connectionDirectory.upsertConnection({
            connectionId: clientId,
            edgeId: cluster.instanceId,
            capabilities: parsed.data.payload.capabilities,
            nowMs,
            ttlMs: connectionTtlMs,
          });
        }

        const connected: WsResponseEnvelope = {
          request_id: parsed.data.request_id,
          type: "connect",
          ok: true,
          result: { client_id: clientId },
        };
        ws.send(JSON.stringify(connected));

        ws.on("close", () => {
          connectionManager.removeClient(clientId!);
          if (cluster) {
            cluster.connectionDirectory.removeConnection(clientId!);
          }
        });

        return;
      }

      // All subsequent messages go through the protocol handler.
      const client = connectionManager.getClient(clientId);
      if (!client) {
        // Client was already evicted (e.g. by heartbeat); close the socket.
        ws.close(4004, "session expired");
        return;
      }

      const errorResponse = handleClientMessage(client, raw, protocolDeps);
      if (errorResponse) {
        ws.send(JSON.stringify(errorResponse));
      }
    });
  });

  function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }

  return { wss, handleUpgrade, stopHeartbeat };
}
