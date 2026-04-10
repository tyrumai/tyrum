import type { IncomingMessage } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import {
  WsConnectInitRequest as WsConnectInitRequestSchema,
  WsConnectProofRequest as WsConnectProofRequestSchema,
  deviceIdFromSha256Digest,
  type AuthTokenClaims,
  type WsConnectInitRequest,
  type WsConnectProofRequest,
  type WsResponseEnvelope,
} from "@tyrum/contracts";
import type { WebSocket, WebSocketServer } from "ws";
import type { AuthTokenService } from "../../app/modules/auth/auth-token-service.js";
import {
  resolveClientIpFromRequest,
  toSingleHeaderValue,
  type TrustedProxyAllowlist,
} from "../../app/modules/auth/client-ip.js";
import type { DesktopEnvironmentDal } from "../../app/modules/desktop-environments/dal.js";
import type { NodePairingDal } from "../../app/modules/node/pairing-dal.js";
import type { PresenceDal } from "../../app/modules/presence/dal.js";
import { handleClientMessage } from "../../ws/protocol.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
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
  type PendingInit,
  parseCapabilitiesFromInit,
  verifyConnectProof,
} from "./connection-support.js";
import { syncConnectionClosed, syncConnectionEstablished } from "./connection-state-sync.js";
import type { WsClusterOptions } from "./types.js";

const EARLY_MESSAGE_MAX_COUNT = 8;
const EARLY_MESSAGE_MAX_BYTES = 64 * 1024;
const GATEWAY_PROTOCOL_REV = 2;

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
  desktopEnvironmentDal?: DesktopEnvironmentDal;
  presenceTtlMs: number;
}

type WsConversationInput = {
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
  desktopEnvironmentDal?: DesktopEnvironmentDal;
  presenceTtlMs: number;
};

export function bindWsConnectionHandler(opts: BindWsConnectionHandlerOptions): void {
  opts.wss.on("connection", (ws, req) => {
    const conversation = new WsConnectionConversation({
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
      desktopEnvironmentDal: opts.desktopEnvironmentDal,
      presenceTtlMs: opts.presenceTtlMs,
    });
    conversation.attach();
  });
}

class WsConnectionConversation {
  private readonly earlyMessages: string[] = [];
  private readonly token: string | undefined;
  private readonly tokenInfo: ReturnType<typeof extractWsTokenWithTransport>;
  private authState: WsAuthState | undefined;
  private clientId: string | undefined;
  private deviceId: string | undefined;
  private earlyMessageBytes = 0;
  private handshakeTimeout: ReturnType<typeof setTimeout> | undefined;
  private pendingInit: PendingInit | undefined;

  constructor(private readonly input: WsConversationInput) {
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
      deviceType: init.payload.device.device_type,
      devicePlatform: init.payload.device.device_platform,
      deviceModel: init.payload.device.device_model,
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

    const claims = auth.kind === "claims" ? auth.claims : this.createScopedNodeClaims(auth);
    this.completeHandshake(pending, claims);

    const response: WsResponseEnvelope = {
      request_id: proof.request_id,
      type: "connect.proof",
      ok: true,
      result: { client_id: pending.connectionId, device_id: pending.deviceId, role: pending.role },
    };
    this.ws.send(JSON.stringify(response));
    queueMicrotask(() => {
      if (this.clientId !== pending.connectionId || this.deviceId !== pending.deviceId) {
        return;
      }
      try {
        const clientIp = resolveClientIpFromRequest(this.req, this.input.trustedProxies);
        syncConnectionEstablished({
          deps: this.input,
          pending,
          claims,
          clientId: pending.connectionId,
          deviceId: pending.deviceId,
          clientIp,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.input.protocolDeps.logger?.warn("ws.connection_established_sync_failed", {
          connection_id: pending.connectionId,
          device_id: pending.deviceId,
          error: message,
        });
      }
    });
  }

  private createScopedNodeClaims(
    auth: Extract<WsAuthState, { kind: "scoped_node" }>,
  ): AuthTokenClaims {
    return {
      token_kind: "device",
      token_id: `pairing:${auth.expectedNodeId}`,
      tenant_id: auth.tenantId,
      device_id: auth.expectedNodeId,
      role: "node",
      scopes: [],
    };
  }

  private completeHandshake(pending: PendingInit, claims: AuthTokenClaims | undefined): void {
    this.clearHandshakeTimeout();
    const clientId = pending.connectionId;
    const deviceId = pending.deviceId;
    this.clientId = clientId;
    this.deviceId = deviceId;
    this.pendingInit = undefined;

    this.input.connectionManager.addClient(this.ws, pending.capabilities, {
      id: clientId,
      role: pending.role,
      deviceId,
      deviceType: pending.deviceType,
      devicePlatform: pending.devicePlatform,
      deviceModel: pending.deviceModel,
      protocolRev: pending.protocolRev,
      authClaims: claims ?? undefined,
    });
    this.ws.on("close", () => {
      this.handleConnectedClose(claims);
    });
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
    syncConnectionClosed({
      deps: this.input,
      connectionId,
      tenantId: claims?.tenant_id,
      deviceId: this.deviceId,
    });
  }

  private handleConnectedMessage(raw: string): void {
    const clientId = this.clientId;
    if (!clientId) return;

    const client = this.input.connectionManager.getClient(clientId);
    if (!client) {
      this.ws.close(4004, "conversation expired");
      return;
    }

    void handleClientMessage(client, raw, this.input.protocolDeps)
      .then((response) => {
        if (response) this.ws.send(JSON.stringify(response));
      })
      .catch(() => {});
  }
}
