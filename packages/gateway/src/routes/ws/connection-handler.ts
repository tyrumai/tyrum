import type { IncomingMessage } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import {
  WsConnectInitRequest as WsConnectInitRequestSchema,
  WsConnectProofRequest as WsConnectProofRequestSchema,
  deviceIdFromSha256Digest,
  type AuthTokenClaims,
  type WsConnectInitRequest,
  type WsConnectProofRequest,
  type WsEventEnvelope,
  type WsResponseEnvelope,
} from "@tyrum/schemas";
import type { WebSocket, WebSocketServer } from "ws";
import type { AuthTokenService } from "../../modules/auth/auth-token-service.js";
import {
  resolveClientIpFromRequest,
  toSingleHeaderValue,
  type TrustedProxyAllowlist,
} from "../../modules/auth/client-ip.js";
import type { NodePairingDal } from "../../modules/node/pairing-dal.js";
import type { PresenceDal } from "../../modules/presence/dal.js";
import { broadcastWsEvent } from "../../ws/broadcast.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import { handleClientMessage } from "../../ws/protocol.js";
import type { ProtocolDeps } from "../../ws/protocol.js";
import { rawDataToUtf8 } from "../../ws/raw-data.js";
import {
  type WsAuthState,
  extractWsTokenWithTransport,
  parseRemoteIp,
  parseRequestPath,
  resolveWsAuth,
} from "./auth.js";
import {
  PAIRING_REQUESTED_AUDIENCE,
  type PendingInit,
  broadcastLocalEvent,
  createPresenceUpsertedEvent,
  parseCapabilitiesFromInit,
  verifyConnectProof,
} from "./connection-support.js";
import type { WsClusterOptions } from "./types.js";

const EARLY_MESSAGE_MAX_COUNT = 8;
const EARLY_MESSAGE_MAX_BYTES = 64 * 1024;
const GATEWAY_PROTOCOL_REV = 2;
type ClientIpInfo = { rawRemoteIp: string | undefined; resolvedClientIp: string | undefined };

interface BindWsConnectionHandlerOptions {
  wss: WebSocketServer;
  connectionManager: ConnectionManager;
  protocolDeps: ProtocolDeps;
  authTokens: AuthTokenService;
  cluster?: WsClusterOptions;
  connectionTtlMs: number;
  trustedProxies?: TrustedProxyAllowlist;
  presenceDal?: PresenceDal;
  nodePairingDal?: NodePairingDal;
  presenceTtlMs: number;
}

type WsSessionInput = {
  ws: WebSocket;
  req: IncomingMessage;
  connectionManager: ConnectionManager;
  protocolDeps: ProtocolDeps;
  authTokens: AuthTokenService;
  cluster?: WsClusterOptions;
  connectionTtlMs: number;
  trustedProxies?: TrustedProxyAllowlist;
  presenceDal?: PresenceDal;
  nodePairingDal?: NodePairingDal;
  presenceTtlMs: number;
};

export function bindWsConnectionHandler(opts: BindWsConnectionHandlerOptions): void {
  opts.wss.on("connection", (ws, req) => {
    const session = new WsConnectionSession({
      ws,
      req,
      connectionManager: opts.connectionManager,
      protocolDeps: opts.protocolDeps,
      authTokens: opts.authTokens,
      cluster: opts.cluster,
      connectionTtlMs: opts.connectionTtlMs,
      trustedProxies: opts.trustedProxies,
      presenceDal: opts.presenceDal,
      nodePairingDal: opts.nodePairingDal,
      presenceTtlMs: opts.presenceTtlMs,
    });
    session.attach();
  });
}

class WsConnectionSession {
  private readonly earlyMessages: string[] = [];
  private readonly token: string | undefined;
  private readonly tokenInfo: ReturnType<typeof extractWsTokenWithTransport>;
  private authState: WsAuthState | undefined;
  private clientId: string | undefined;
  private deviceId: string | undefined;
  private earlyMessageBytes = 0;
  private handshakeTimeout: ReturnType<typeof setTimeout> | undefined;
  private pendingInit: PendingInit | undefined;

  constructor(private readonly input: WsSessionInput) {
    this.tokenInfo = extractWsTokenWithTransport(input.req);
    this.token = this.tokenInfo.token;
  }

  private get ws(): WebSocket {
    return this.input.ws;
  }
  private get req(): IncomingMessage {
    return this.input.req;
  }

  attach(): void {
    this.ws.once("close", () => this.clearHandshakeTimeout());
    this.ws.on("message", (data) => this.handleSocketMessage(data));
    void this.startAuthResolution();
  }

  private handleSocketMessage(data: unknown): void {
    const raw = rawDataToUtf8(data as Parameters<typeof rawDataToUtf8>[0]);
    if (!this.authState) {
      if (!this.enqueueEarlyMessage(raw)) {
        this.ws.close(4003, "handshake overflow");
      }
      return;
    }
    this.handleRawMessage(raw);
  }

  private enqueueEarlyMessage(raw: string): boolean {
    this.earlyMessageBytes += Buffer.byteLength(raw, "utf-8");
    if (
      this.earlyMessages.length >= EARLY_MESSAGE_MAX_COUNT ||
      this.earlyMessageBytes > EARLY_MESSAGE_MAX_BYTES
    ) {
      return false;
    }
    this.earlyMessages.push(raw);
    return true;
  }

  private async startAuthResolution(): Promise<void> {
    try {
      const resolved = await resolveWsAuth({
        token: this.token,
        authTokens: this.input.authTokens,
        nodePairingDal: this.input.nodePairingDal,
      });
      if (!resolved) {
        await this.closeUnauthorized();
        return;
      }
      this.authState = resolved;
      this.startHandshakeTimeout();
      this.flushEarlyMessages();
    } catch (err) {
      void err;
      await this.closeUnauthorized();
    }
  }

  private async closeUnauthorized(): Promise<void> {
    try {
      await this.recordUpgradeAuthFailed();
    } finally {
      this.ws.close(4001, "unauthorized");
    }
  }

  private async recordUpgradeAuthFailed(): Promise<void> {
    const authAudit = this.input.protocolDeps.authAudit;
    if (!authAudit) return;

    try {
      await authAudit.recordAuthFailed({
        surface: "ws.upgrade",
        reason: this.token ? "invalid_token" : "missing_token",
        token_transport: this.tokenInfo.transport,
        client_ip: parseRemoteIp(this.req),
        method: this.req.method,
        path: parseRequestPath(this.req),
        user_agent: toSingleHeaderValue(this.req.headers["user-agent"])?.trim() || undefined,
        request_id: toSingleHeaderValue(this.req.headers["x-request-id"])?.trim() || undefined,
      });
    } catch (err) {
      void err;
    }
  }

  private startHandshakeTimeout(): void {
    if (this.handshakeTimeout) return;
    this.handshakeTimeout = setTimeout(() => {
      if (this.clientId === undefined) this.ws.close(4002, "handshake timeout");
    }, 10_000);
    this.handshakeTimeout.unref();
  }

  private clearHandshakeTimeout(): void {
    if (!this.handshakeTimeout) return;
    clearTimeout(this.handshakeTimeout);
    this.handshakeTimeout = undefined;
  }

  private flushEarlyMessages(): void {
    for (const raw of this.earlyMessages.splice(0)) this.handleRawMessage(raw);
    this.earlyMessageBytes = 0;
  }

  private handleRawMessage(raw: string): void {
    if (!this.authState) return;
    if (!this.clientId) return void this.handleHandshakeMessage(raw, this.authState);
    this.handleConnectedMessage(raw);
  }

  private handleHandshakeMessage(raw: string, auth: WsAuthState): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      void err;
      this.ws.close(4003, "invalid json");
      return;
    }

    const init = WsConnectInitRequestSchema.safeParse(json);
    if (init.success) return void this.handleConnectInit(init.data, auth);
    const proof = WsConnectProofRequestSchema.safeParse(json);
    if (proof.success) return void this.handleConnectProof(proof.data, auth);

    if (
      typeof json === "object" &&
      json !== null &&
      "type" in json &&
      (json as { type?: unknown }).type === "connect"
    ) {
      this.ws.close(4003, "legacy connect is deprecated; use connect.init/connect.proof");
      return;
    }

    this.ws.close(4003, "expected connect.init/connect.proof");
  }

  private handleConnectInit(init: WsConnectInitRequest, auth: WsAuthState): void {
    if (init.payload.protocol_rev !== GATEWAY_PROTOCOL_REV) {
      this.ws.close(4005, "protocol_rev mismatch");
      return;
    }
    if (auth.kind === "scoped_node" && init.payload.role !== "node")
      return void this.ws.close(4001, "unauthorized");

    const pubkeyDer = Buffer.from(init.payload.device.pubkey, "base64url");
    const expectedDeviceId = deviceIdFromSha256Digest(
      createHash("sha256").update(pubkeyDer).digest(),
    );
    if (expectedDeviceId !== init.payload.device.device_id)
      return void this.ws.close(4006, "device_id mismatch");
    if (!this.isAuthorizedDeviceToken(auth, init, expectedDeviceId))
      return void this.ws.close(4001, "unauthorized");
    if (auth.kind === "scoped_node" && expectedDeviceId !== auth.expectedNodeId)
      return void this.ws.close(4008, "scoped token mismatch");

    const connectionId = crypto.randomUUID();
    const challenge = randomBytes(32).toString("base64url");
    this.pendingInit = {
      protocolRev: init.payload.protocol_rev,
      role: init.payload.role,
      deviceId: expectedDeviceId,
      pubkey: init.payload.device.pubkey,
      label: init.payload.device.label,
      platform: init.payload.device.platform,
      version: init.payload.device.version,
      mode: init.payload.device.mode,
      capabilities: parseCapabilitiesFromInit(init.payload),
      connectionId,
      challenge,
    };

    const response: WsResponseEnvelope = {
      request_id: init.request_id,
      type: "connect.init",
      ok: true,
      result: { connection_id: connectionId, challenge },
    };
    this.ws.send(JSON.stringify(response));
  }

  private isAuthorizedDeviceToken(
    auth: WsAuthState,
    init: WsConnectInitRequest,
    expectedDeviceId: string,
  ): boolean {
    const claims = auth.kind === "claims" ? auth.claims : undefined;
    if (claims?.token_kind !== "device") return true;
    return claims.role === init.payload.role && claims.device_id === expectedDeviceId;
  }

  private handleConnectProof(proof: WsConnectProofRequest, auth: WsAuthState): void {
    const pending = this.pendingInit;
    if (!pending) return void this.ws.close(4003, "expected connect.init first");
    if (proof.payload.connection_id !== pending.connectionId)
      return void this.ws.close(4003, "connection_id mismatch");
    if (!verifyConnectProof(pending, proof.payload.proof))
      return void this.ws.close(4007, "invalid proof");

    const claims = auth.kind === "claims" ? auth.claims : undefined;
    this.completeHandshake(pending, claims);

    const response: WsResponseEnvelope = {
      request_id: proof.request_id,
      type: "connect.proof",
      ok: true,
      result: { client_id: pending.connectionId, device_id: pending.deviceId, role: pending.role },
    };
    this.ws.send(JSON.stringify(response));
  }

  private completeHandshake(pending: PendingInit, claims: AuthTokenClaims | undefined): void {
    this.clearHandshakeTimeout();
    this.clientId = pending.connectionId;
    this.deviceId = pending.deviceId;
    this.pendingInit = undefined;

    this.input.connectionManager.addClient(this.ws, pending.capabilities, {
      id: this.clientId,
      role: pending.role,
      deviceId: this.deviceId,
      protocolRev: pending.protocolRev,
      authClaims: claims ?? undefined,
    });

    const clientIp = resolveClientIpFromRequest(this.req, this.input.trustedProxies);
    this.persistClusterConnection(pending, claims);
    this.upsertPresenceOnConnect(pending, clientIp);
    this.upsertNodePairingOnConnect(pending, clientIp, claims);
    this.ws.on("close", () => {
      this.handleConnectedClose(claims);
    });
  }

  private persistClusterConnection(
    pending: PendingInit,
    claims: AuthTokenClaims | undefined,
  ): void {
    if (!this.input.cluster || !this.clientId || !this.deviceId) return;

    const nowMs = Date.now();
    void this.input.cluster.connectionDirectory
      .upsertConnection({
        tenantId: claims?.tenant_id ?? undefined,
        connectionId: this.clientId,
        edgeId: this.input.cluster.instanceId,
        role: pending.role,
        protocolRev: pending.protocolRev,
        deviceId: this.deviceId,
        pubkey: pending.pubkey,
        label: pending.label ?? null,
        version: pending.version ?? null,
        mode: pending.mode ?? null,
        capabilities: pending.capabilities,
        nowMs,
        ttlMs: this.input.connectionTtlMs,
      })
      .catch(() => {});
  }

  private upsertPresenceOnConnect(pending: PendingInit, clientIp: ClientIpInfo): void {
    if (!this.input.presenceDal || !this.clientId || !this.deviceId) return;

    const nowMs = Date.now();
    const persistedClientIp = toPersistedClientIp(clientIp);
    void this.input.presenceDal
      .upsert({
        instanceId: this.deviceId,
        role: pending.role,
        connectionId: this.clientId,
        host: pending.label ?? null,
        ip: persistedClientIp.ip,
        version: pending.version ?? null,
        mode: pending.mode ?? null,
        metadata: {
          capabilities: pending.capabilities,
          edge_id: this.input.cluster?.instanceId ?? null,
          ...persistedClientIp.metadata,
        },
        nowMs,
        ttlMs: this.input.presenceTtlMs,
      })
      .then((row) => {
        broadcastLocalEvent(this.input.connectionManager, createPresenceUpsertedEvent(row));
      })
      .catch(() => {});
  }

  private upsertNodePairingOnConnect(
    pending: PendingInit,
    clientIp: ClientIpInfo,
    claims: AuthTokenClaims | undefined,
  ): void {
    if (!this.input.nodePairingDal || pending.role !== "node") return;

    const nowIso = new Date().toISOString();
    const nodeId = pending.deviceId;
    const persistedClientIp = toPersistedClientIp(clientIp);
    void this.input.nodePairingDal
      .getByNodeId(nodeId)
      .then((previous) => {
        return this.input
          .nodePairingDal!.upsertOnConnect({
            nodeId,
            pubkey: pending.pubkey,
            label: pending.label ?? null,
            capabilities: pending.capabilities,
            metadata: {
              ip: persistedClientIp.ip,
              ...persistedClientIp.metadata,
              platform: pending.platform ?? null,
              version: pending.version ?? null,
              mode: pending.mode ?? null,
              edge_id: this.input.cluster?.instanceId ?? null,
            },
            nowIso,
          })
          .then((pairing) => {
            const shouldRequest =
              pairing.status === "pending" &&
              (!previous || previous.status === "denied" || previous.status === "revoked");
            if (!shouldRequest) return;
            this.broadcastPairingRequested(pairing, claims);
          });
      })
      .catch(() => {});
  }

  private broadcastPairingRequested(pairing: unknown, claims: AuthTokenClaims | undefined): void {
    const tenantId = claims?.tenant_id;
    if (!tenantId) return;

    const event = {
      event_id: crypto.randomUUID(),
      type: "pairing.requested",
      occurred_at: new Date().toISOString(),
      payload: { pairing },
    } satisfies WsEventEnvelope;

    broadcastWsEvent(
      tenantId,
      event,
      {
        connectionManager: this.input.connectionManager,
        cluster: this.input.protocolDeps.cluster,
        logger: this.input.protocolDeps.logger,
        maxBufferedBytes: this.input.protocolDeps.maxBufferedBytes,
      },
      PAIRING_REQUESTED_AUDIENCE,
    );
  }

  private handleConnectedClose(claims: AuthTokenClaims | undefined): void {
    const connectionId = this.clientId;
    if (!connectionId) return;

    try {
      this.input.protocolDeps.onConnectionClosed?.(connectionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.input.protocolDeps.logger?.warn("ws.connection_close_hook_failed", {
        connection_id: connectionId,
        error: message,
      });
    }

    this.input.connectionManager.removeClient(connectionId);
    this.removeClusterConnection(connectionId, claims?.tenant_id);
    this.markPresenceDisconnected();
  }

  private removeClusterConnection(connectionId: string, tenantId: string | null | undefined): void {
    if (!this.input.cluster || !tenantId) return;
    void this.input.cluster.connectionDirectory
      .removeConnection({ tenantId, connectionId })
      .catch(() => {});
  }

  private markPresenceDisconnected(): void {
    if (!this.input.presenceDal || !this.deviceId) return;
    void this.input.presenceDal
      .markDisconnected({
        instanceId: this.deviceId,
        nowMs: Date.now(),
        ttlMs: this.input.presenceTtlMs,
      })
      .catch(() => {});
  }

  private handleConnectedMessage(raw: string): void {
    const clientId = this.clientId;
    if (!clientId) return;

    const client = this.input.connectionManager.getClient(clientId);
    if (!client) {
      this.ws.close(4004, "session expired");
      return;
    }

    void handleClientMessage(client, raw, this.input.protocolDeps)
      .then((response) => {
        if (response) this.ws.send(JSON.stringify(response));
      })
      .catch(() => {});
  }
}

function toPersistedClientIp(input: ClientIpInfo): {
  ip: string | null;
  metadata: {
    raw_remote_ip: string | null;
    resolved_client_ip: string | null;
  };
} {
  const ip = input.resolvedClientIp ?? input.rawRemoteIp ?? null;
  return {
    ip,
    metadata: {
      raw_remote_ip: input.rawRemoteIp ?? null,
      resolved_client_ip: ip,
    },
  };
}
