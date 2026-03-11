import type { WsPeerRole, WsRequestEnvelope, WsResponseEnvelope } from "@tyrum/schemas";
import {
  capabilityDescriptorsForClientCapability,
  normalizeCapabilityDescriptors,
  WsConnectInitResult,
  WsConnectProofResult,
} from "@tyrum/schemas";

import {
  buildConnectProofTranscript,
  computeDeviceIdFromPublicKeyDer,
  createDeviceIdentity,
  formatDeviceIdentityError,
  fromBase64Url,
  signProofWithPrivateKey,
} from "./device-identity.js";
import { loadNodePinnedTransportModule } from "./load-node-pinned-transport.js";
import { normalizeFingerprint256 } from "./tls/fingerprint.js";
import { TyrumClientProtocolCore } from "./ws-client.protocol.js";

type GeneratedDevice = {
  publicKey: string;
  privateKey: string;
  deviceId: string;
};

type ResolvedConnectDevice = GeneratedDevice & {
  label?: string;
  platform?: string;
  version?: string;
  mode?: string;
};

const WS_BASE_PROTOCOL = "tyrum-v1";
const WS_AUTH_PROTOCOL_PREFIX = "tyrum-auth.";
const TERMINAL_RECONNECT_CLOSE_CODES = new Set<number>([4005, 4006, 4007, 4008]);

function toOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toBase64UrlUtf8(value: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf-8").toString("base64url");
  }

  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function formatCloseReason(code: number, reason: string): string {
  const trimmedReason = reason.trim();
  return trimmedReason.length > 0
    ? `WebSocket closed with ${code} (${trimmedReason}).`
    : `WebSocket closed with ${code}.`;
}

function getTerminalReconnectMessage(code: number, reason: string, token: string): string | null {
  if (TERMINAL_RECONNECT_CLOSE_CODES.has(code)) {
    const closeReason = formatCloseReason(code, reason);
    switch (code) {
      case 4005:
        return `${closeReason} Check the client and gateway protocol revisions before reconnecting.`;
      case 4006:
        return `${closeReason} Check the configured device_id and device key pair before reconnecting.`;
      case 4007:
        return `${closeReason} Check the configured device private key before reconnecting.`;
      case 4008:
        return `${closeReason} Check that the scoped token matches this device before reconnecting.`;
      default:
        return closeReason;
    }
  }

  if (code === 4001 && token.trim().length > 0) {
    return `${formatCloseReason(code, reason)} Refresh or replace the configured token before reconnecting.`;
  }

  return null;
}

export abstract class TyrumClientTransportCore extends TyrumClientProtocolCore {
  private generatedDevice: GeneratedDevice | null = null;
  private generatedDevicePromise: Promise<GeneratedDevice> | null = null;

  protected openSocket(): void {
    this.ready = false;
    this.clientId = null;
    this.transportErrorHint = null;
    this.suppressReconnect = false;
    this.resetProtocolErrorReporting();
    const attempt = ++this.connectionAttempt;
    void this.openSocketAttempt(attempt);
  }

  private buildProtocols(): string[] {
    const token = this.opts.token;
    if (token.trim().length === 0) {
      return [WS_BASE_PROTOCOL];
    }
    return [WS_BASE_PROTOCOL, `${WS_AUTH_PROTOCOL_PREFIX}${toBase64UrlUtf8(token)}`];
  }

  private destroyPinnedDispatcher(ws: WebSocket): void {
    const anyWs = ws as unknown as { __tyrumDispatcher?: { destroy?: () => unknown } | null };
    const dispatcher = anyWs.__tyrumDispatcher;
    if (!dispatcher || typeof dispatcher.destroy !== "function") {
      return;
    }
    anyWs.__tyrumDispatcher = null;
    void loadNodePinnedTransportModule()
      .then((module) => module.destroyPinnedNodeDispatcher(dispatcher as never))
      .catch(() => {});
  }

  private async createWebSocket(): Promise<WebSocket> {
    const pinRaw = this.opts.tlsCertFingerprint256?.trim();
    const allowSelfSigned = Boolean(this.opts.tlsAllowSelfSigned);
    if (!pinRaw) {
      if (allowSelfSigned) {
        throw new Error("tlsAllowSelfSigned requires tlsCertFingerprint256.");
      }
      return new WebSocket(this.opts.url, this.buildProtocols());
    }

    const expected = normalizeFingerprint256(pinRaw);
    if (!expected) {
      throw new Error("Invalid tlsCertFingerprint256; expected a SHA-256 hex fingerprint.");
    }

    const url = new URL(this.opts.url);
    if (url.protocol !== "wss:") {
      throw new Error("tlsCertFingerprint256 requires a wss:// URL.");
    }

    const isNode =
      typeof process !== "undefined" &&
      typeof process.versions === "object" &&
      typeof process.versions.node === "string";
    if (!isNode) {
      throw new Error("tlsCertFingerprint256 is supported only in Node.js clients.");
    }

    const caCertPemRaw = typeof this.opts.tlsCaCertPem === "string" ? this.opts.tlsCaCertPem : "";
    const caCertPemTrimmed = caCertPemRaw.trim();
    const caCertPem = caCertPemTrimmed.length > 0 ? caCertPemTrimmed : undefined;
    const nodeTransport = await loadNodePinnedTransportModule();
    const { ws, dispatcher } = await nodeTransport.createPinnedNodeWebSocket({
      url: this.opts.url,
      protocols: this.buildProtocols(),
      pinRaw,
      expectedFingerprint256: expected,
      allowSelfSigned,
      caCertPem,
      onTransportError: (message) => {
        this.transportErrorHint = message;
      },
      onPinFailure: () => {
        this.suppressReconnect = true;
      },
    });
    (ws as unknown as { __tyrumDispatcher?: unknown }).__tyrumDispatcher = dispatcher;
    return ws;
  }

  private async openSocketAttempt(attempt: number): Promise<void> {
    let ws: WebSocket;
    try {
      ws = await this.createWebSocket();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emitter.emit("transport_error", { message });
      return;
    }

    if (this.intentionalClose || attempt !== this.connectionAttempt) {
      ws.close(1000, "stale connect attempt");
      this.destroyPinnedDispatcher(ws);
      return;
    }

    this.ws = ws;
    ws.addEventListener("open", () => {
      this.sendConnect();
    });
    ws.addEventListener("message", (event: MessageEvent) => {
      this.handleMessage(event.data as string);
    });
    ws.addEventListener("close", (event: CloseEvent) => {
      const terminalReconnectMessage = getTerminalReconnectMessage(
        event.code,
        event.reason,
        this.opts.token,
      );
      if (terminalReconnectMessage) {
        this.suppressReconnect = true;
        this.emitter.emit("transport_error", { message: terminalReconnectMessage });
      }

      this.emitter.emit("disconnected", { code: event.code, reason: event.reason });
      this.ws = null;
      this.ready = false;
      this.clientId = null;
      this.rejectPending(new Error("WebSocket disconnected"));
      const suppressReconnect = this.suppressReconnect;
      this.suppressReconnect = false;
      if (!this.intentionalClose && this.opts.reconnect && !suppressReconnect) {
        this.scheduleReconnect();
      }
      this.destroyPinnedDispatcher(ws);
    });
    ws.addEventListener("error", (event) => {
      const anyEvent = event as unknown as { message?: unknown; error?: unknown };
      const eventErrorMessage =
        anyEvent.error instanceof Error && anyEvent.error.message.trim().length > 0
          ? anyEvent.error.message
          : null;
      const eventMessage =
        typeof anyEvent.message === "string" && anyEvent.message.trim().length > 0
          ? anyEvent.message
          : null;
      const message =
        eventErrorMessage ??
        eventMessage ??
        (this.transportErrorHint && this.transportErrorHint.trim().length > 0
          ? this.transportErrorHint
          : null) ??
        "WebSocket transport error";
      this.emitter.emit("transport_error", { message });
    });
  }

  private sendConnect(): void {
    void this.sendConnectWithDeviceProof();
  }

  private disconnectIfHandshakeSocketActive(handshakeWs: WebSocket): void {
    if (this.ws !== handshakeWs || handshakeWs.readyState !== WebSocket.OPEN) {
      return;
    }
    this.disconnect();
  }

  private async sendConnectWithDeviceProof(): Promise<void> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      const device = await this.resolveConnectDevice();
      const pubkey = device.publicKey.trim();
      const privkey = device.privateKey.trim();
      if (!pubkey || !privkey) {
        this.disconnectIfHandshakeSocketActive(ws);
        return;
      }

      const deviceId = device.deviceId.trim();
      if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const role = this.opts.role;
      const protocolRev = this.opts.protocolRev;
      const requestId = crypto.randomUUID();
      const advertisedCapabilities = normalizeCapabilityDescriptors(
        this.opts.advertisedCapabilities ??
          this.opts.capabilities.flatMap((capability) =>
            capabilityDescriptorsForClientCapability(capability),
          ),
      );
      const request: WsRequestEnvelope = {
        request_id: requestId,
        type: "connect.init",
        payload: {
          protocol_rev: protocolRev,
          role,
          device: {
            device_id: deviceId,
            pubkey,
            label: toOptionalTrimmedString(device.label),
            platform: toOptionalTrimmedString(device.platform),
            version: toOptionalTrimmedString(device.version),
            mode: toOptionalTrimmedString(device.mode),
          },
          capabilities: advertisedCapabilities,
        },
      };

      this.pending.set(requestId, {
        resolve: (msg) => {
          void this.handleConnectInitResponse(
            msg,
            { deviceId, role, protocolRev, privateKey: privkey },
            ws,
          );
        },
        reject: () => {},
      });
      this.send(request);
    } catch (error) {
      this.emitter.emit("transport_error", { message: formatDeviceIdentityError(error) });
      this.disconnectIfHandshakeSocketActive(ws);
    }
  }

  private async resolveConnectDevice(): Promise<ResolvedConnectDevice> {
    const provided = this.opts.device;
    if (provided) {
      const pubkey = provided.publicKey.trim();
      const privkey = provided.privateKey.trim();
      if (!pubkey || !privkey) {
        throw new Error("TyrumClientOptions.device must include publicKey and privateKey");
      }
      if (provided.deviceId?.trim()) {
        return { ...provided, deviceId: provided.deviceId.trim() };
      }
      const pubkeyDer = fromBase64Url(pubkey);
      const computed = await computeDeviceIdFromPublicKeyDer(pubkeyDer);
      return { ...provided, deviceId: computed };
    }

    if (!this.generatedDevice) {
      if (!this.generatedDevicePromise) {
        this.generatedDevicePromise = createDeviceIdentity()
          .then((generatedDevice) => {
            this.generatedDevice = generatedDevice;
            return generatedDevice;
          })
          .catch((error) => {
            this.generatedDevicePromise = null;
            throw error;
          });
      }
      this.generatedDevice = await this.generatedDevicePromise;
    }
    return this.generatedDevice;
  }

  private async handleConnectInitResponse(
    msg: WsResponseEnvelope,
    ctx: { deviceId: string; role: WsPeerRole; protocolRev: number; privateKey: string },
    handshakeWs: WebSocket,
  ): Promise<void> {
    if (!msg.ok) {
      this.disconnectIfHandshakeSocketActive(handshakeWs);
      return;
    }
    const parsed = WsConnectInitResult.safeParse(msg.result ?? {});
    if (!parsed.success) {
      this.disconnectIfHandshakeSocketActive(handshakeWs);
      return;
    }

    try {
      const transcript = buildConnectProofTranscript({
        protocolRev: ctx.protocolRev,
        role: ctx.role,
        deviceId: ctx.deviceId,
        connectionId: parsed.data.connection_id,
        challenge: parsed.data.challenge,
      });
      const proof = await signProofWithPrivateKey(ctx.privateKey, transcript);
      if (this.ws !== handshakeWs || handshakeWs.readyState !== WebSocket.OPEN) {
        return;
      }

      const requestId = crypto.randomUUID();
      const request: WsRequestEnvelope = {
        request_id: requestId,
        type: "connect.proof",
        payload: { connection_id: parsed.data.connection_id, proof },
      };

      this.pending.set(requestId, {
        resolve: (msg2) => {
          if (this.ws !== handshakeWs) {
            return;
          }
          if (!msg2.ok) {
            this.disconnectIfHandshakeSocketActive(handshakeWs);
            return;
          }
          const parsed2 = WsConnectProofResult.safeParse(msg2.result ?? {});
          if (!parsed2.success) {
            this.disconnectIfHandshakeSocketActive(handshakeWs);
            return;
          }
          this.reconnectAttempt = 0;
          this.ready = true;
          this.clientId = parsed2.data.client_id;
          this.emitter.emit("connected", { clientId: parsed2.data.client_id });
        },
        reject: () => {},
      });
      this.send(request);
    } catch {
      this.disconnectIfHandshakeSocketActive(handshakeWs);
    }
  }
}
