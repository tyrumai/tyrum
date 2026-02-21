/**
 * WebSocket upgrade handler.
 *
 * Uses the `ws` library to accept upgrade requests, authenticate via token,
 * wait for the initial `hello` handshake, and then wire all subsequent
 * messages through the protocol dispatcher.
 */

import { WebSocketServer, type RawData } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  ClientCapability,
  WS_PROTOCOL_REV,
  WsConnectInitRequest,
  WsConnectProofRequest,
  base32Encode,
  type WsResponseEnvelope,
} from "@tyrum/schemas";
import type {
  CapabilityDescriptor,
  ClientCapability as ClientCapabilityT,
  DeviceDescriptor,
  PeerRole,
} from "@tyrum/schemas";
import type { ConnectionManager } from "../ws/connection-manager.js";
import { handleClientMessage } from "../ws/protocol.js";
import type { ProtocolDeps } from "../ws/protocol.js";
import type { TokenStore } from "../modules/auth/token-store.js";
import type { ConnectionDirectoryDal } from "../modules/backplane/connection-directory.js";
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import type { SqlDb } from "../statestore/types.js";
import { NodePairingService } from "../modules/node/pairing-service.js";
import { NodeTokenDal, type NodeTokenRecord } from "../modules/node/token-dal.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Interval between heartbeat ticks (milliseconds). */
const HEARTBEAT_INTERVAL_MS = 5_000;
const WS_BASE_PROTOCOL = "tyrum-v1";
const WS_AUTH_PROTOCOL_PREFIX = "tyrum-auth.";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function normalizeRemoteIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  return ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
}

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

function decodeBase64UrlBytes(input: string): Buffer | undefined {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padding);
    const decoded = Buffer.from(padded, "base64");
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

function deriveDeviceId(pubkeyBytes: Uint8Array): string {
  const digest = createHash("sha256").update(pubkeyBytes).digest();
  return `dev-${base32Encode(digest)}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

function deriveNodeEnrollmentToken(adminToken: string): string {
  // Stable derivation so operators can provision nodes without sharing the admin token.
  return sha256Hex(`tyrum-node-enrollment-v1|${adminToken}`);
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf-8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf-8");
  return data.toString("utf-8");
}

function pickClientCapabilities(
  advertised: readonly CapabilityDescriptor[],
): ClientCapabilityT[] {
  const out: ClientCapabilityT[] = [];
  const seen = new Set<string>();
  for (const cap of advertised) {
    const name = cap.name;
    if (seen.has(name)) continue;
    if (ClientCapability.safeParse(name).success) {
      out.push(name as ClientCapabilityT);
      seen.add(name);
    }
  }
  return out;
}

function handshakeTranscript(params: {
  protocolRev: number;
  role: PeerRole;
  deviceId: string;
  challenge: string;
}): Buffer {
  const transcript =
    `tyrum-handshake-v1|${params.protocolRev}|${params.role}|${params.deviceId}|${params.challenge}`;
  return Buffer.from(transcript, "utf-8");
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export interface WsRouteOptions {
  connectionManager: ConnectionManager;
  protocolDeps: ProtocolDeps;
  tokenStore: TokenStore;
  db: SqlDb;
  /** Whether to auto-approve loopback nodes (dev convenience). Defaults to env/true. */
  nodeAutoApproveLoopback?: boolean;
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
  const { connectionManager, protocolDeps: baseDeps, tokenStore } = opts;
  const cluster = opts.cluster;
  const connectionTtlMs = cluster?.connectionTtlMs ?? 30_000;
  const autoApproveLoopback = (() => {
    if (opts.nodeAutoApproveLoopback !== undefined) return opts.nodeAutoApproveLoopback;
    const raw = process.env["TYRUM_NODE_AUTO_APPROVE_LOOPBACK"]?.trim().toLowerCase();
    return raw == null || raw.length === 0 ? true : !["0", "false", "off", "no"].includes(raw);
  })();

  const nodePairingService = new NodePairingService(opts.db, {
    logger: baseDeps.logger,
    autoApproveLoopback,
  });
  const nodeTokenDal = new NodeTokenDal(opts.db);

  const enrollmentTokenEnv = process.env["TYRUM_NODE_ENROLLMENT_TOKEN"]?.trim();
  const enrollmentToken = enrollmentTokenEnv && enrollmentTokenEnv.length > 0
    ? enrollmentTokenEnv
    : (() => {
        const admin = tokenStore.getToken();
        return admin ? deriveNodeEnrollmentToken(admin) : undefined;
      })();

  const protocolDeps: ProtocolDeps = { ...baseDeps, nodePairingService, nodeTokenDal };

  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => selectWsSubprotocol(protocols),
  });

  // --- heartbeat timer ---
  let pruning = false;
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

    if (protocolDeps.presence && !pruning) {
      pruning = true;
      void protocolDeps.presence
        .prune()
        .then(({ expired, trimmed }) => {
          const pruned = [...expired, ...trimmed];
          for (const instanceId of pruned) {
            const evt = {
              event_id: crypto.randomUUID(),
              type: "presence.prune",
              occurred_at: new Date().toISOString(),
              payload: { instance_id: instanceId },
            };
            const payload = JSON.stringify(evt);
            for (const c of connectionManager.allClients()) {
              if (c.role !== "client") continue;
              c.ws.send(payload);
            }
            if (protocolDeps.cluster) {
              void protocolDeps.cluster.outboxDal.enqueue("ws.broadcast", {
                source_edge_id: protocolDeps.cluster.edgeId,
                skip_local: true,
                target_role: "client",
                message: evt,
              }).catch(() => {
                // best-effort
              });
            }
          }
        })
        .catch(() => {
          // best-effort
        })
        .finally(() => {
          pruning = false;
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
    const token = extractWsTokenFromProtocols(req);

    if (!token) {
      ws.close(4001, "unauthorized");
      return;
    }

    type HandshakeState = "await_init" | "await_proof" | "ready";
    let state: HandshakeState = "await_init";

    type WsAuth =
      | { kind: "client_admin" }
      | { kind: "node_enrollment" }
      | { kind: "node_scoped"; record: NodeTokenRecord };
    let auth: WsAuth | undefined;

    let connectionId: string | undefined;
    let challenge: string | undefined;
    let role: PeerRole | undefined;
    let deviceId: string | undefined;
    let devicePubkeyBytes: Buffer | undefined;
    let clientCapabilities: ClientCapabilityT[] = [];
    let deviceDescriptor: DeviceDescriptor | undefined;

    const handshakeTimeout = setTimeout(() => {
      if (state !== "ready") {
        ws.close(4002, "handshake timeout");
      }
    }, 10_000);

    const handleMessage = async (data: RawData): Promise<void> => {
      const raw = rawDataToString(data);

      if (state !== "ready") {
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          ws.close(4003, "invalid json");
          return;
        }

        if (state === "await_init") {
          const parsed = WsConnectInitRequest.safeParse(json);
          if (!parsed.success) {
            ws.close(4003, "expected connect.init request");
            return;
          }
          if (parsed.data.payload.protocol_rev !== WS_PROTOCOL_REV) {
            ws.close(4005, "protocol_rev mismatch");
            return;
          }

          const pubkeyBytes = decodeBase64UrlBytes(parsed.data.payload.device.pubkey);
          if (!pubkeyBytes || pubkeyBytes.length !== 32) {
            ws.close(4006, "invalid device pubkey");
            return;
          }

          const derived = deriveDeviceId(pubkeyBytes);
          if (derived !== parsed.data.payload.device.device_id) {
            ws.close(4007, "invalid device_id");
            return;
          }

          // Authenticate token based on intended peer role.
          if (parsed.data.payload.role === "client") {
            if (!tokenStore.validate(token)) {
              ws.close(4001, "unauthorized");
              return;
            }
            auth = { kind: "client_admin" };
          } else {
            if (!enrollmentToken) {
              ws.close(4001, "unauthorized");
              return;
            }

            if (token === enrollmentToken) {
              auth = { kind: "node_enrollment" };
            } else {
              const record = await nodeTokenDal.findActiveByToken(token);
              if (!record || record.node_id !== derived) {
                ws.close(4001, "unauthorized");
                return;
              }
              auth = { kind: "node_scoped", record };
            }
          }

          connectionId = crypto.randomUUID();
          challenge = randomBytes(32).toString("base64url");
          role = parsed.data.payload.role;
          deviceId = parsed.data.payload.device.device_id;
          devicePubkeyBytes = pubkeyBytes;
          clientCapabilities = pickClientCapabilities(parsed.data.payload.capabilities);
          deviceDescriptor = parsed.data.payload.device;

          const initResp: WsResponseEnvelope = {
            request_id: parsed.data.request_id,
            type: "connect.init",
            ok: true,
            result: {
              connection_id: connectionId,
              challenge,
            },
          };
          ws.send(JSON.stringify(initResp));
          state = "await_proof";
          return;
        }

        const proof = WsConnectProofRequest.safeParse(json);
        if (!proof.success) {
          ws.close(4003, "expected connect.proof request");
          return;
        }
        if (
          !connectionId ||
          !challenge ||
          !role ||
          !deviceId ||
          !devicePubkeyBytes ||
          !deviceDescriptor ||
          !auth
        ) {
          ws.close(4010, "handshake state missing");
          return;
        }
        if (proof.data.payload.connection_id !== connectionId) {
          ws.close(4008, "connection_id mismatch");
          return;
        }

        const signatureBytes = decodeBase64UrlBytes(proof.data.payload.proof);
        if (!signatureBytes || signatureBytes.length !== 64) {
          ws.close(4009, "invalid proof");
          return;
        }

        const transcript = handshakeTranscript({
          protocolRev: WS_PROTOCOL_REV,
          role,
          deviceId,
          challenge,
        });

        const spki = Buffer.concat([ED25519_SPKI_PREFIX, devicePubkeyBytes]);
        const publicKey = createPublicKey({ key: spki, format: "der", type: "spki" });
        const ok = verify(null, transcript, publicKey, signatureBytes);
        if (!ok) {
          ws.close(4009, "invalid proof");
          return;
        }

        clearTimeout(handshakeTimeout);
        state = "ready";

        let effectiveCapabilities = clientCapabilities;
        if (role === "node") {
          const remoteIp = normalizeRemoteIp(req.socket.remoteAddress);
          const observed = await nodePairingService.observeNode({
            nodeId: deviceId,
            label: deviceDescriptor.label,
            capabilities: clientCapabilities,
            metadata: { device: deviceDescriptor, remote_ip: remoteIp },
            remoteIp,
          });

          if (observed.pairing.status === "approved") {
            if (auth.kind === "node_enrollment") {
              // Issue a scoped token and force the node to reconnect using it.
              await nodeTokenDal.revokeAllForNode({ nodeId: deviceId });
              const issued = await nodeTokenDal.issueToken({
                nodeId: deviceId,
                capabilities: observed.pairing.node.capabilities,
                metadata: {
                  pairing_id: observed.pairing.pairing_id,
                  issued_for: "pairing.approved",
                },
              });

              const proofResp: WsResponseEnvelope = {
                request_id: proof.data.request_id,
                type: "connect.proof",
                ok: true,
                result: {},
              };

              ws.send(JSON.stringify(proofResp), () => {
                const evt = {
                  event_id: crypto.randomUUID(),
                  type: "pairing.approved",
                  occurred_at: new Date().toISOString(),
                  payload: {
                    node_id: deviceId,
                    scoped_token: issued.token,
                    capabilities: issued.record.capabilities,
                  },
                };
                ws.send(JSON.stringify(evt), () => {
                  try {
                    ws.close(1012, "pairing approved; reconnect with scoped token");
                  } catch {
                    // ignore
                  }
                });
              });
              return;
            }

            // Scoped token connections are limited to the allowlisted capabilities.
            const scopedAuth = auth;
            effectiveCapabilities =
              scopedAuth.kind === "node_scoped"
                ? clientCapabilities.filter((cap) => scopedAuth.record.capabilities.includes(cap))
                : [];
          } else {
            // Pairing not approved → no capability execution allowed.
            effectiveCapabilities = [];

            if (auth.kind === "node_scoped") {
              ws.close(4001, "pairing not approved");
              return;
            }
          }

          if (observed.isNewRequest) {
            const evt = {
              event_id: crypto.randomUUID(),
              type: "pairing.requested",
              occurred_at: new Date().toISOString(),
              payload: { pairing: observed.pairing },
            };
            const payload = JSON.stringify(evt);
            for (const c of connectionManager.allClients()) {
              if (c.role !== "client") continue;
              c.ws.send(payload);
            }
            if (protocolDeps.cluster) {
              void protocolDeps.cluster.outboxDal
                .enqueue("ws.broadcast", {
                  source_edge_id: protocolDeps.cluster.edgeId,
                  skip_local: true,
                  target_role: "client",
                  message: evt,
                })
                .catch(() => {
                  // best-effort
                });
            }
          }
        }

        connectionManager.addClient({
          connectionId,
          ws,
          role,
          instanceId: deviceId,
          device: deviceDescriptor,
          capabilities: effectiveCapabilities,
        });

        if (cluster) {
          const nowMs = Date.now();
          cluster.connectionDirectory.upsertConnection({
            connectionId,
            edgeId: cluster.instanceId,
            capabilities: effectiveCapabilities,
            nowMs,
            ttlMs: connectionTtlMs,
          });
        }

        const remoteIp = normalizeRemoteIp(req.socket.remoteAddress);
        if (protocolDeps.presence) {
          void protocolDeps.presence
            .upsertFromConnect({ role, device: deviceDescriptor, remoteIp })
            .then((entry) => {
              const evt = {
                event_id: crypto.randomUUID(),
                type: "presence.upsert",
                occurred_at: new Date().toISOString(),
                payload: { entry },
              };
              const payload = JSON.stringify(evt);
              for (const c of connectionManager.allClients()) {
                if (c.role !== "client") continue;
                c.ws.send(payload);
              }
              if (protocolDeps.cluster) {
                void protocolDeps.cluster.outboxDal
                  .enqueue("ws.broadcast", {
                    source_edge_id: protocolDeps.cluster.edgeId,
                    skip_local: true,
                    target_role: "client",
                    message: evt,
                  })
                  .catch(() => {
                    // best-effort
                  });
              }
            })
            .catch(() => {
              // best-effort
            });
        }

        const proofResp: WsResponseEnvelope = {
          request_id: proof.data.request_id,
          type: "connect.proof",
          ok: true,
          result: {},
        };
        ws.send(JSON.stringify(proofResp));

        ws.on("close", () => {
          const id = connectionId;
          if (!id) return;
          connectionManager.removeClient(id);
          if (cluster) {
            cluster.connectionDirectory.removeConnection(id);
          }
        });

        return;
      }

      // All subsequent messages go through the protocol handler.
      const client = connectionId ? connectionManager.getClient(connectionId) : undefined;
      if (!client) {
        // Client was already evicted (e.g. by heartbeat); close the socket.
        ws.close(4004, "session expired");
        return;
      }

      const errorResponse = await handleClientMessage(client, raw, protocolDeps);
      if (errorResponse) {
        ws.send(JSON.stringify(errorResponse));
      }
    };

    ws.on("message", (data) => {
      void handleMessage(data).catch(() => {
        // best-effort; do not leak errors to the transport
        try {
          ws.close(1011, "internal error");
        } catch {
          // ignore
        }
      });
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
