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
import { WsConnectRequest, WsConnectInitRequest, WsConnectProofRequest, type ClientCapability, type WsResponseEnvelope } from "@tyrum/schemas";
import type { ConnectionManager } from "../ws/connection-manager.js";
import { validateWsToken } from "../ws/auth.js";
import { handleClientMessage } from "../ws/protocol.js";
import type { ProtocolDeps } from "../ws/protocol.js";
import type { TokenStore } from "../modules/auth/token-store.js";
import type { ConnectionDirectoryDal } from "../modules/backplane/connection-directory.js";
import { HandshakeStateMachine } from "../ws/handshake.js";

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

  // --- strict handshake feature flag ---
  const strictHandshake = (() => {
    const raw = process.env["TYRUM_STRICT_HANDSHAKE"]?.trim().toLowerCase();
    if (!raw) return false; // default off
    return ["1", "true", "on", "yes"].includes(raw);
  })();

  // --- connection handler ---
  wss.on("connection", (ws, req) => {
    const token = extractWsTokenFromProtocols(req);

    if (!validateWsToken(token, tokenStore)) {
      ws.close(4001, "unauthorized");
      return;
    }

    // Per-connection handshake state machine for v2 flow.
    const handshake = new HandshakeStateMachine();

    // Mutable slot: filled once the hello handshake completes.
    let clientId: string | undefined;
    // Capabilities captured during connect.init, used when connect.proof completes.
    let initCapabilities: readonly ClientCapability[] = [];

    const helloTimeout = setTimeout(() => {
      if (clientId === undefined) {
        ws.close(4002, "hello timeout");
      }
    }, 5_000);

    /** Wire up the close handler and register in the cluster directory. */
    function finalizeConnection(
      id: string,
      capabilities: readonly ClientCapability[],
    ): void {
      if (cluster) {
        const nowMs = Date.now();
        cluster.connectionDirectory.upsertConnection({
          connectionId: id,
          edgeId: cluster.instanceId,
          capabilities,
          nowMs,
          ttlMs: connectionTtlMs,
        });
      }

      ws.on("close", () => {
        connectionManager.removeClient(id);
        if (cluster) {
          cluster.connectionDirectory.removeConnection(id);
        }
      });
    }

    ws.on("message", (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf-8");

      if (clientId === undefined) {
        // First (or second) message — handshake phase.
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          ws.close(4003, "invalid json");
          return;
        }

        const msgType = (json as Record<string, unknown>).type;

        // ----- Legacy v1 connect -----
        if (msgType === "connect") {
          if (strictHandshake) {
            ws.close(4003, "legacy connect disabled");
            return;
          }

          const parsed = WsConnectRequest.safeParse(json);
          if (!parsed.success) {
            ws.close(4003, "expected connect request");
            return;
          }

          clearTimeout(helloTimeout);
          clientId = connectionManager.addClient(ws, parsed.data.payload.capabilities, { protocolRev: "v1" });
          finalizeConnection(clientId, parsed.data.payload.capabilities);

          const connected: WsResponseEnvelope = {
            request_id: parsed.data.request_id,
            type: "connect",
            ok: true,
            result: { client_id: clientId },
          };
          ws.send(JSON.stringify(connected));
          return;
        }

        // ----- New v2 connect.init -----
        if (msgType === "connect.init") {
          const parsed = WsConnectInitRequest.safeParse(json);
          if (!parsed.success) {
            ws.close(4003, "invalid connect.init");
            return;
          }

          const result = handshake.handleInit({
            protocol_rev: parsed.data.payload.protocol_rev,
            device_id: parsed.data.payload.device_id,
            capabilities: parsed.data.payload.capabilities,
          });

          if (result.state === "connected") {
            // No device_id means skip challenge — complete immediately.
            clearTimeout(helloTimeout);
            clientId = connectionManager.addClient(ws, parsed.data.payload.capabilities, {
              protocolRev: result.protocolRev,
            });
            finalizeConnection(clientId, parsed.data.payload.capabilities);

            const connected: WsResponseEnvelope = {
              request_id: parsed.data.request_id,
              type: "connect.init",
              ok: true,
              result: { challenge_id: "none", client_id: clientId },
            };
            ws.send(JSON.stringify(connected));
            return;
          }

          if (result.state === "challenged" && result.challenge) {
            // Store capabilities for use when connect.proof completes.
            initCapabilities = parsed.data.payload.capabilities;
            // Send challenge — expect connect.proof as next message.
            ws.send(JSON.stringify({
              request_id: parsed.data.request_id,
              type: "connect.init",
              ok: true,
              result: {
                challenge_id: result.challenge.challenge_id,
                challenge: result.challenge.challenge,
                expires_at: new Date(result.challenge.expires_at).toISOString(),
              },
            }));
            return;
          }

          ws.close(4003, result.error ?? "handshake failed");
          return;
        }

        // ----- v2 connect.proof (second message after connect.init) -----
        if (msgType === "connect.proof") {
          if (handshake.getState() !== "challenged") {
            ws.close(4003, "unexpected connect.proof");
            return;
          }

          const parsed = WsConnectProofRequest.safeParse(json);
          if (!parsed.success) {
            ws.close(4003, "invalid connect.proof");
            return;
          }

          const result = handshake.handleProof({
            challenge_id: parsed.data.payload.challenge_id,
            proof: parsed.data.payload.proof,
            device_id: parsed.data.payload.device_id,
          });

          if (result.state === "connected") {
            clearTimeout(helloTimeout);
            clientId = connectionManager.addClient(ws, initCapabilities, {
              protocolRev: result.protocolRev,
              deviceId: result.deviceId,
            });
            finalizeConnection(clientId, initCapabilities);

            const connected: WsResponseEnvelope = {
              request_id: parsed.data.request_id,
              type: "connect.proof",
              ok: true,
              result: { authenticated: true },
            };
            ws.send(JSON.stringify(connected));
            return;
          }

          ws.close(4003, result.error ?? "proof failed");
          return;
        }

        ws.close(4003, "expected connect or connect.init request");
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
