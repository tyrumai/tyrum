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
import {
  WsConnectInitRequest,
  WsConnectProofRequest,
  clientCapabilityFromDescriptorId,
  deviceIdFromSha256Digest,
  type CapabilityDescriptor,
  type ClientCapability,
  type AuthTokenClaims,
  type WsPeerRole,
  type WsResponseEnvelope,
  type WsEventEnvelope,
} from "@tyrum/schemas";
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import type { ConnectionManager } from "../ws/connection-manager.js";
import { rawDataToUtf8 } from "../ws/raw-data.js";
import { handleClientMessage } from "../ws/protocol.js";
import type { ProtocolDeps } from "../ws/protocol.js";
import { broadcastWsEvent } from "../ws/broadcast.js";
import type { AuthTokenService } from "../modules/auth/auth-token-service.js";
import { AUTH_COOKIE_NAME, extractBearerToken } from "../modules/auth/http.js";
import { createTrustedProxyAllowlistFromEnv, resolveClientIp } from "../modules/auth/client-ip.js";
import type { SlidingWindowRateLimiter } from "../modules/auth/rate-limiter.js";
import type { ConnectionDirectoryDal } from "../modules/backplane/connection-directory.js";
import type { PresenceDal } from "../modules/presence/dal.js";
import type { NodePairingDal } from "../modules/node/pairing-dal.js";
import type { WsBroadcastAudience } from "../ws/audience.js";

const PAIRING_REQUESTED_AUDIENCE: WsBroadcastAudience = {
  roles: ["client"],
  required_scopes: ["operator.pairing"],
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Interval between heartbeat ticks (milliseconds). */
const HEARTBEAT_INTERVAL_MS = 5_000;
const WS_BASE_PROTOCOL = "tyrum-v1";
const WS_AUTH_PROTOCOL_PREFIX = "tyrum-auth.";
const GATEWAY_PROTOCOL_REV = 2;

function buildConnectProofTranscript(input: {
  protocolRev: number;
  role: WsPeerRole;
  deviceId: string;
  connectionId: string;
  challenge: string;
}): Buffer {
  // Stable, explicit transcript to prevent replay across connections.
  const text =
    `tyrum-connect-proof\n` +
    `protocol_rev=${String(input.protocolRev)}\n` +
    `role=${input.role}\n` +
    `device_id=${input.deviceId}\n` +
    `connection_id=${input.connectionId}\n` +
    `challenge=${input.challenge}\n`;
  return Buffer.from(text, "utf-8");
}

function parseCapabilitiesFromInit(payload: {
  capabilities: CapabilityDescriptor[];
}): ClientCapability[] {
  return [
    ...new Set(
      payload.capabilities
        .map((capability) => clientCapabilityFromDescriptorId(capability.id))
        .filter((capability): capability is ClientCapability => capability !== undefined),
    ),
  ];
}

function parseRemoteIp(req: IncomingMessage): string | undefined {
  const sock = req.socket;
  const ip = sock?.remoteAddress?.trim();
  if (!ip) return undefined;
  return ip;
}

function parseProtocolHeader(value: string | string[] | undefined): string[] {
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
  } catch (err) {
    void err;
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

function extractCookieValue(
  headerValue: string | string[] | undefined,
  cookieName: string,
): string | undefined {
  if (!headerValue) return undefined;
  const text = Array.isArray(headerValue) ? headerValue.join(";") : headerValue;
  for (const part of text.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const name = trimmed.slice(0, idx).trim();
    if (name !== cookieName) continue;
    const value = trimmed.slice(idx + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

function toSingleHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : undefined;
}

function parseHostHeader(
  value: string,
): { hostname: string; port: string | undefined } | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("[")) {
    const closingIdx = trimmed.indexOf("]");
    if (closingIdx <= 1) return undefined;
    const hostname = trimmed.slice(1, closingIdx);
    const rest = trimmed.slice(closingIdx + 1);
    if (!rest) return { hostname, port: undefined };
    if (!rest.startsWith(":")) return undefined;
    const port = rest.slice(1).trim();
    if (!port) return undefined;
    return { hostname, port };
  }

  const parts = trimmed.split(":");
  if (parts.length === 1) {
    return { hostname: parts[0]!.trim(), port: undefined };
  }
  if (parts.length === 2) {
    const hostname = parts[0]!.trim();
    const port = parts[1]!.trim();
    if (!hostname || !port) return undefined;
    return { hostname, port };
  }
  return undefined;
}

function isSameOriginUpgrade(req: IncomingMessage): boolean {
  const originValue = toSingleHeaderValue(req.headers["origin"]);
  const hostValue = toSingleHeaderValue(req.headers["host"]);
  if (!originValue || !hostValue) return false;

  let originUrl: URL;
  try {
    originUrl = new URL(originValue);
  } catch (err) {
    void err;
    return false;
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return false;

  const defaultPort = originUrl.protocol === "https:" ? "443" : "80";
  const originPort = originUrl.port || defaultPort;
  const host = parseHostHeader(hostValue);
  if (!host) return false;
  const hostPort = host.port ?? defaultPort;

  return (
    host.hostname.toLowerCase() === originUrl.hostname.toLowerCase() && hostPort === originPort
  );
}

function extractWsTokenWithTransport(req: IncomingMessage): {
  token: string | undefined;
  transport: "authorization" | "cookie" | "subprotocol" | "missing";
} {
  const bearer = extractBearerToken(req.headers["authorization"]);
  if (bearer) {
    return { token: bearer, transport: "authorization" };
  }

  const cookieToken = extractCookieValue(req.headers["cookie"], AUTH_COOKIE_NAME);
  if (cookieToken && isSameOriginUpgrade(req)) {
    return { token: cookieToken, transport: "cookie" };
  }

  const subprotocolToken = extractWsTokenFromProtocols(req);
  if (subprotocolToken) {
    return { token: subprotocolToken, transport: "subprotocol" };
  }

  if (cookieToken) {
    return { token: undefined, transport: "cookie" };
  }

  return { token: undefined, transport: "missing" };
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
  authTokens: AuthTokenService;
  trustedProxies?: string;
  upgradeRateLimiter?: SlidingWindowRateLimiter;
  presenceDal?: PresenceDal;
  nodePairingDal?: NodePairingDal;
  cluster?: {
    instanceId: string;
    connectionDirectory: ConnectionDirectoryDal;
    connectionTtlMs?: number;
  };
  presence?: {
    ttlMs?: number;
    maxEntries?: number;
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
  const { connectionManager, protocolDeps, authTokens } = opts;
  const upgradeRateLimiter = opts.upgradeRateLimiter;
  const trustedProxies = upgradeRateLimiter
    ? createTrustedProxyAllowlistFromEnv(opts.trustedProxies)
    : undefined;
  const cluster = opts.cluster;
  const connectionTtlMs = cluster?.connectionTtlMs ?? 30_000;
  const presenceDal = opts.presenceDal;
  const nodePairingDal = opts.nodePairingDal;
  const presenceTtlMs = opts.presence?.ttlMs ?? 60_000;
  const presenceMaxEntries = opts.presence?.maxEntries ?? 500;

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
        const tenantId = client.auth_claims?.tenant_id;
        if (!tenantId) continue;
        void cluster.connectionDirectory
          .touchConnection({
            tenantId,
            connectionId: client.id,
            nowMs,
            ttlMs: connectionTtlMs,
          })
          .catch(() => {});
      }
      void cluster.connectionDirectory.cleanupExpired(nowMs).catch(() => {});
    }

    if (presenceDal) {
      const nowMs = Date.now();
      for (const client of connectionManager.allClients()) {
        if (client.device_id) {
          void presenceDal
            .touch({ instanceId: client.device_id, nowMs, ttlMs: presenceTtlMs })
            .catch(() => {});
        }
      }
      void presenceDal
        .pruneExpired(nowMs)
        .then((pruned) => {
          if (pruned.length === 0) return;
          for (const instanceId of pruned) {
            const evt = {
              event_id: crypto.randomUUID(),
              type: "presence.pruned",
              occurred_at: new Date().toISOString(),
              payload: { instance_id: instanceId },
            };

            for (const peer of connectionManager.allClients()) {
              try {
                peer.ws.send(JSON.stringify(evt));
              } catch (err) {
                void err;
                // ignore
              }
            }
          }
        })
        .catch(() => {
          // ignore prune failures (best-effort)
        });
      void presenceDal.enforceCap(presenceMaxEntries).catch(() => {
        // ignore
      });
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Prevent the timer from keeping the process alive.
  heartbeatTimer.unref();

  function stopHeartbeat(): void {
    clearInterval(heartbeatTimer);
  }

  // --- connection handler ---
  wss.on("connection", (ws, req) => {
    const tokenInfo = extractWsTokenWithTransport(req);
    const token = tokenInfo.token;

    type UpgradeClaims = AuthTokenClaims;
    type AuthState =
      | { kind: "claims"; claims: UpgradeClaims }
      | { kind: "scoped_node"; expectedNodeId: string };

    const EARLY_MESSAGE_MAX_COUNT = 8;
    const EARLY_MESSAGE_MAX_BYTES = 64 * 1024;

    const earlyMessages: string[] = [];
    let earlyMessageBytes = 0;
    let authState: AuthState | undefined = undefined;

    // Mutable slot: filled once the hello handshake completes.
    let clientId: string | undefined;
    let deviceId: string | undefined;

    let handshakeTimeout: ReturnType<typeof setTimeout> | undefined;

    const clearHandshakeTimeout = (): void => {
      if (!handshakeTimeout) return;
      clearTimeout(handshakeTimeout);
      handshakeTimeout = undefined;
    };

    const startHandshakeTimeout = (): void => {
      if (handshakeTimeout) return;
      handshakeTimeout = setTimeout(() => {
        if (clientId === undefined) {
          ws.close(4002, "handshake timeout");
        }
      }, 10_000);
      handshakeTimeout.unref();
    };

    // Ensure handshake timeout is cleared even if the socket closes before completing a handshake.
    ws.once("close", () => {
      clearHandshakeTimeout();
    });

    let pendingInit:
      | undefined
      | {
          protocolRev: number;
          role: WsPeerRole;
          deviceId: string;
          pubkey: string;
          label?: string;
          platform?: string;
          version?: string;
          mode?: string;
          capabilities: ClientCapability[];
          connectionId: string;
          challenge: string;
        };

    const resolveAuth = async (): Promise<AuthState | undefined> => {
      if (authState) return authState;
      if (!token) return undefined;

      const claims = await authTokens.authenticate(token).catch(() => null);
      if (claims) {
        // System tokens are HTTP-only (/system/*) and are not valid for WS surfaces.
        if (claims.tenant_id === null) return undefined;
        return { kind: "claims", claims };
      }

      if (!nodePairingDal) return undefined;
      const nodeId = await nodePairingDal.getNodeIdForScopedToken(token).catch(() => undefined);
      return nodeId ? { kind: "scoped_node", expectedNodeId: nodeId } : undefined;
    };

    const flushEarlyMessages = (): void => {
      for (const raw of earlyMessages.splice(0)) {
        handleRawMessage(raw);
      }
      earlyMessageBytes = 0;
    };

    const handleRawMessage = (raw: string): void => {
      const auth = authState;
      if (!auth) return;

      const scopedExpectedNodeId = auth.kind === "scoped_node" ? auth.expectedNodeId : undefined;
      const claims = auth.kind === "claims" ? auth.claims : undefined;

      if (clientId === undefined) {
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch (err) {
          void err;
          ws.close(4003, "invalid json");
          return;
        }

        // vNext handshake: connect.init
        const init = WsConnectInitRequest.safeParse(json);
        if (init.success) {
          if (init.data.payload.protocol_rev !== GATEWAY_PROTOCOL_REV) {
            ws.close(4005, "protocol_rev mismatch");
            return;
          }

          if (auth.kind === "scoped_node" && init.data.payload.role !== "node") {
            ws.close(4001, "unauthorized");
            return;
          }

          const pubkeyDer = Buffer.from(init.data.payload.device.pubkey, "base64url");
          const expectedDeviceId = deviceIdFromSha256Digest(
            createHash("sha256").update(pubkeyDer).digest(),
          );
          if (expectedDeviceId !== init.data.payload.device.device_id) {
            ws.close(4006, "device_id mismatch");
            return;
          }

          // Bind device tokens to the peer identity proof. This prevents replaying
          // a valid device token across different device proofs.
          if (claims?.token_kind === "device") {
            if (claims.role !== init.data.payload.role) {
              ws.close(4001, "unauthorized");
              return;
            }
            if (claims.device_id !== expectedDeviceId) {
              ws.close(4001, "unauthorized");
              return;
            }
          }

          if (scopedExpectedNodeId && expectedDeviceId !== scopedExpectedNodeId) {
            ws.close(4008, "scoped token mismatch");
            return;
          }

          const connectionId = crypto.randomUUID();
          const challenge = randomBytes(32).toString("base64url");
          pendingInit = {
            protocolRev: init.data.payload.protocol_rev,
            role: init.data.payload.role,
            deviceId: expectedDeviceId,
            pubkey: init.data.payload.device.pubkey,
            label: init.data.payload.device.label,
            platform: init.data.payload.device.platform,
            version: init.data.payload.device.version,
            mode: init.data.payload.device.mode,
            capabilities: parseCapabilitiesFromInit(init.data.payload),
            connectionId,
            challenge,
          };

          const response: WsResponseEnvelope = {
            request_id: init.data.request_id,
            type: "connect.init",
            ok: true,
            result: {
              connection_id: connectionId,
              challenge,
            },
          };
          ws.send(JSON.stringify(response));
          return;
        }

        // vNext handshake: connect.proof
        const proof = WsConnectProofRequest.safeParse(json);
        if (proof.success) {
          if (!pendingInit) {
            ws.close(4003, "expected connect.init first");
            return;
          }
          if (proof.data.payload.connection_id !== pendingInit.connectionId) {
            ws.close(4003, "connection_id mismatch");
            return;
          }

          let ok = false;
          try {
            const pubkeyDer = Buffer.from(pendingInit.pubkey, "base64url");
            const key = createPublicKey({ key: pubkeyDer, format: "der", type: "spki" });
            const sig = Buffer.from(proof.data.payload.proof, "base64url");
            const transcript = buildConnectProofTranscript({
              protocolRev: pendingInit.protocolRev,
              role: pendingInit.role,
              deviceId: pendingInit.deviceId,
              connectionId: pendingInit.connectionId,
              challenge: pendingInit.challenge,
            });
            ok = verify(null, transcript, key, sig);
          } catch (err) {
            void err;
            ok = false;
          }

          if (!ok) {
            ws.close(4007, "invalid proof");
            return;
          }

          clearHandshakeTimeout();
          clientId = pendingInit.connectionId;
          deviceId = pendingInit.deviceId;
          connectionManager.addClient(ws, pendingInit.capabilities, {
            id: clientId,
            role: pendingInit.role,
            deviceId,
            protocolRev: pendingInit.protocolRev,
            authClaims: claims ?? undefined,
          });

          if (cluster) {
            const nowMs = Date.now();
            void cluster.connectionDirectory
              .upsertConnection({
                tenantId: claims?.tenant_id ?? undefined,
                connectionId: clientId,
                edgeId: cluster.instanceId,
                role: pendingInit.role,
                protocolRev: pendingInit.protocolRev,
                deviceId,
                pubkey: pendingInit.pubkey,
                label: pendingInit.label ?? null,
                version: pendingInit.version ?? null,
                mode: pendingInit.mode ?? null,
                capabilities: pendingInit.capabilities,
                nowMs,
                ttlMs: connectionTtlMs,
              })
              .catch(() => {});
          }

          const remoteIp = parseRemoteIp(req);
          if (presenceDal) {
            const nowMs = Date.now();
            void presenceDal
              .upsert({
                instanceId: deviceId,
                role: pendingInit.role,
                connectionId: clientId,
                host: pendingInit.label ?? null,
                ip: remoteIp ?? null,
                version: pendingInit.version ?? null,
                mode: pendingInit.mode ?? null,
                metadata: {
                  capabilities: pendingInit.capabilities,
                  edge_id: cluster?.instanceId ?? null,
                },
                nowMs,
                ttlMs: presenceTtlMs,
              })
              .then((row) => {
                const entry = {
                  instance_id: row.instance_id,
                  role: row.role,
                  host: row.host ?? undefined,
                  ip: row.ip ?? undefined,
                  version: row.version ?? undefined,
                  mode: (row.mode ?? undefined) as string | undefined,
                  last_seen_at: new Date(row.last_seen_at_ms).toISOString(),
                  last_input_seconds: row.last_input_seconds ?? undefined,
                  reason: "connect" as const,
                  metadata: row.metadata,
                };
                const evt = {
                  event_id: crypto.randomUUID(),
                  type: "presence.upserted",
                  occurred_at: new Date().toISOString(),
                  payload: { entry },
                };

                // Local broadcast (best-effort).
                for (const peer of connectionManager.allClients()) {
                  try {
                    peer.ws.send(JSON.stringify(evt));
                  } catch (err) {
                    void err;
                    // ignore
                  }
                }
              })
              .catch(() => {
                // ignore presence errors
              });
          }

          if (nodePairingDal && pendingInit.role === "node") {
            const nowIso = new Date().toISOString();
            const nodeId = deviceId;
            void nodePairingDal
              .getByNodeId(nodeId)
              .then((prev) => {
                return nodePairingDal
                  .upsertOnConnect({
                    nodeId,
                    pubkey: pendingInit!.pubkey,
                    label: pendingInit!.label ?? null,
                    capabilities: pendingInit!.capabilities,
                    metadata: {
                      ip: remoteIp ?? null,
                      platform: pendingInit!.platform ?? null,
                      version: pendingInit!.version ?? null,
                      mode: pendingInit!.mode ?? null,
                      edge_id: cluster?.instanceId ?? null,
                    },
                    nowIso,
                  })
                  .then((pairing) => {
                    const shouldRequest =
                      pairing.status === "pending" &&
                      (!prev || prev.status === "denied" || prev.status === "revoked");
                    if (!shouldRequest) return;

                    const evt = {
                      event_id: crypto.randomUUID(),
                      type: "pairing.requested",
                      occurred_at: new Date().toISOString(),
                      payload: { pairing },
                    } satisfies WsEventEnvelope;

                    const tenantId = claims?.tenant_id;
                    if (tenantId) {
                      broadcastWsEvent(
                        tenantId,
                        evt,
                        { connectionManager, cluster: protocolDeps.cluster },
                        PAIRING_REQUESTED_AUDIENCE,
                      );
                    }
                  });
              })
              .catch(() => {
                // ignore pairing errors
              });
          }

          const response: WsResponseEnvelope = {
            request_id: proof.data.request_id,
            type: "connect.proof",
            ok: true,
            result: { client_id: clientId, device_id: deviceId, role: pendingInit.role },
          };
          ws.send(JSON.stringify(response));

          ws.on("close", () => {
            try {
              protocolDeps.onConnectionClosed?.(clientId!);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              protocolDeps.logger?.warn("ws.connection_close_hook_failed", {
                connection_id: clientId!,
                error: message,
              });
            }
            connectionManager.removeClient(clientId!);
            if (cluster) {
              const tenantId = claims?.tenant_id;
              if (tenantId) {
                void cluster.connectionDirectory
                  .removeConnection({ tenantId, connectionId: clientId! })
                  .catch(() => {});
              }
            }
            if (presenceDal && deviceId) {
              void presenceDal
                .markDisconnected({ instanceId: deviceId, nowMs: Date.now(), ttlMs: presenceTtlMs })
                .catch(() => {
                  // ignore
                });
            }
          });

          return;
        }

        if (
          typeof json === "object" &&
          json !== null &&
          "type" in json &&
          (json as { type?: unknown }).type === "connect"
        ) {
          ws.close(4003, "legacy connect is deprecated; use connect.init/connect.proof");
          return;
        }

        ws.close(4003, "expected connect.init/connect.proof");
        return;
      }

      // All subsequent messages go through the protocol handler.
      const client = connectionManager.getClient(clientId);
      if (!client) {
        // Client was already evicted (e.g. by heartbeat); close the socket.
        ws.close(4004, "session expired");
        return;
      }

      void handleClientMessage(client, raw, protocolDeps)
        .then((response) => {
          if (response) {
            ws.send(JSON.stringify(response));
          }
        })
        .catch(() => {
          // ignore per-connection handler errors; caller may retry
        });
    };

    ws.on("message", (data) => {
      const raw = rawDataToUtf8(data);
      if (!authState) {
        earlyMessageBytes += Buffer.byteLength(raw, "utf-8");
        if (
          earlyMessages.length >= EARLY_MESSAGE_MAX_COUNT ||
          earlyMessageBytes > EARLY_MESSAGE_MAX_BYTES
        ) {
          ws.close(4003, "handshake overflow");
          return;
        }
        earlyMessages.push(raw);
        return;
      }
      handleRawMessage(raw);
    });

    if (authState) {
      startHandshakeTimeout();
      return;
    }

    const requestPath = (() => {
      try {
        return new URL(req.url ?? "/", "http://localhost").pathname;
      } catch (err) {
        void err;
        return undefined;
      }
    })();

    const userAgent = toSingleHeaderValue(req.headers["user-agent"])?.trim() || undefined;
    const requestId = toSingleHeaderValue(req.headers["x-request-id"])?.trim() || undefined;

    const recordUpgradeAuthFailed = async (): Promise<void> => {
      const authAudit = protocolDeps.authAudit;
      if (!authAudit) return;

      try {
        await authAudit.recordAuthFailed({
          surface: "ws.upgrade",
          reason: token ? "invalid_token" : "missing_token",
          token_transport: tokenInfo.transport,
          client_ip: parseRemoteIp(req),
          method: req.method,
          path: requestPath,
          user_agent: userAgent,
          request_id: requestId,
        });
      } catch (err) {
        void err;
        // ignore audit failures; the socket still must close
      }
    };

    void resolveAuth()
      .then(async (resolved) => {
        if (!resolved) {
          try {
            await recordUpgradeAuthFailed();
          } finally {
            ws.close(4001, "unauthorized");
          }
          return;
        }
        authState = resolved;
        startHandshakeTimeout();
        flushEarlyMessages();
      })
      .catch(async () => {
        try {
          await recordUpgradeAuthFailed();
        } finally {
          ws.close(4001, "unauthorized");
        }
      });
  });

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (upgradeRateLimiter) {
      const clientIp = resolveClientIp({
        remoteAddress: req.socket.remoteAddress,
        forwardedHeader: toSingleHeaderValue(req.headers["forwarded"]),
        xForwardedForHeader: toSingleHeaderValue(req.headers["x-forwarded-for"]),
        xRealIpHeader: toSingleHeaderValue(req.headers["x-real-ip"]),
        trustedProxies,
      });

      if (clientIp) {
        const result = upgradeRateLimiter.check(`ws:${clientIp}`);
        if (!result.allowed) {
          const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
          const response = [
            "HTTP/1.1 429 Too Many Requests",
            `Retry-After: ${String(retryAfterSeconds)}`,
            "Connection: close",
            "Content-Length: 0",
            "",
            "",
          ].join("\r\n");

          try {
            socket.write(response);
          } catch (err) {
            void err;
            // ignore
          }
          try {
            socket.destroy();
          } catch (err) {
            void err;
            // ignore
          }
          return;
        }
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }

  return { wss, handleUpgrade, stopHeartbeat };
}
