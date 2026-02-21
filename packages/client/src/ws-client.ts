/**
 * TyrumClient — lightweight WebSocket client for the Tyrum gateway.
 *
 * Connects via the standard WebSocket API (available natively in Node 24+
 * and all modern browsers), sends/receives typed protocol messages, and
 * optionally auto-reconnects with exponential backoff.
 */

import type { Emitter } from "mitt";

// mitt's CJS type declarations lack a .d.mts, so under Node16 +
// verbatimModuleSyntax the default import is typed as the module
// namespace rather than the factory function.  We import the
// namespace and extract the default at runtime.
import * as mittNs from "mitt";

const mitt = (
  typeof mittNs.default === "function" ? mittNs.default : mittNs
) as unknown as <T extends Record<string, unknown>>() => Emitter<T>;

import type { ClientCapability, WsRequestEnvelope, WsResponseEnvelope } from "@tyrum/schemas";
import type { WsApprovalListResult as WsApprovalListResultT } from "@tyrum/schemas";
import type { WsApprovalResolveResult as WsApprovalResolveResultT } from "@tyrum/schemas";
import type { WsCommandExecuteResult as WsCommandExecuteResultT } from "@tyrum/schemas";
import type { WsPeerRole } from "@tyrum/schemas";
import {
  deviceIdFromSha256Digest,
  WsApprovalDecision,
  WsApprovalRequest,
  WsApprovalListResult,
  type WsApprovalListPayload,
  WsApprovalResolveResult,
  type WsApprovalResolvePayload,
  WsCommandExecuteResult,
  WsConnectInitResult,
  WsConnectProofResult,
  WsConnectResult,
  WsError,
  WsErrorEvent,
  WsMessageEnvelope,
  WsPlanUpdateEvent,
  WsTaskExecuteRequest,
  WsTaskExecuteResult,
} from "@tyrum/schemas";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type TyrumClientEvents = {
  connected: { clientId: string };
  disconnected: { code: number; reason: string };
  task_execute: WsTaskExecuteRequest;
  approval_request: WsApprovalRequest;
  plan_update: WsPlanUpdateEvent;
  error: WsErrorEvent;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface TyrumClientOptions {
  /** Full WebSocket URL, e.g. ws://host/ws */
  url: string;
  /** Auth token sent via WebSocket subprotocol metadata. */
  token: string;
  /** Capabilities to advertise in the hello handshake. */
  capabilities: ClientCapability[];
  /**
   * Whether to use the vNext `connect.init/connect.proof` handshake.
   * Defaults to `false` (legacy `connect`).
   */
  useDeviceProof?: boolean;
  /** Peer role for vNext handshake. Defaults to `client`. */
  role?: WsPeerRole;
  /** Protocol revision for vNext handshake. Defaults to 2. */
  protocolRev?: number;
  /**
   * Ed25519 key material for vNext handshake (DER, base64url).
   *
   * - `publicKey`: SPKI DER (base64url)
   * - `privateKey`: PKCS8 DER (base64url)
   */
  device?: {
    publicKey: string;
    privateKey: string;
    deviceId?: string;
    label?: string;
    platform?: string;
    version?: string;
    mode?: string;
  };
  /** Whether to auto-reconnect on unexpected close. Defaults to `true`. */
  reconnect?: boolean;
  /** Upper bound for reconnect backoff delay in milliseconds. Defaults to 30 000. */
  maxReconnectDelay?: number;
  /**
   * Maximum number of recent event ids to keep for deduplication.
   * Defaults to 1000.
   */
  maxSeenEventIds?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;
const DEFAULT_MAX_SEEN_EVENT_IDS = 1_000;
const WS_BASE_PROTOCOL = "tyrum-v1";
const WS_AUTH_PROTOCOL_PREFIX = "tyrum-auth.";
const DEFAULT_PROTOCOL_REV = 2;

function toBase64UrlBytes(value: Uint8Array): string {
  // Node runtime path.
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value).toString("base64url");
  }

  // Browser runtime path.
  let binary = "";
  for (const b of value) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "base64url");
  }

  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = bytes.buffer;
  if (buf instanceof ArrayBuffer) {
    return buf.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto subtle API not available");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return new Uint8Array(digest);
}

async function computeDeviceId(pubkeyDer: Uint8Array): Promise<string> {
  const digest = await sha256(pubkeyDer);
  return deviceIdFromSha256Digest(digest);
}

function buildConnectProofTranscript(input: {
  protocolRev: number;
  role: WsPeerRole;
  deviceId: string;
  connectionId: string;
  challenge: string;
}): Uint8Array {
  const text =
    `tyrum-connect-proof\n` +
    `protocol_rev=${String(input.protocolRev)}\n` +
    `role=${input.role}\n` +
    `device_id=${input.deviceId}\n` +
    `connection_id=${input.connectionId}\n` +
    `challenge=${input.challenge}\n`;
  return new TextEncoder().encode(text);
}

async function signEd25519Pkcs8(privateKeyDer: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto subtle API not available");
  }
  const key = await globalThis.crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(privateKeyDer),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const sig = await globalThis.crypto.subtle.sign({ name: "Ed25519" }, key, toArrayBuffer(message));
  return new Uint8Array(sig);
}

function toBase64UrlUtf8(value: string): string {
  // Node runtime path.
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf-8").toString("base64url");
  }

  // Browser runtime path.
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class TyrumClient {
  private readonly emitter: Emitter<TyrumClientEvents>;
  private readonly opts: TyrumClientOptions & {
    reconnect: boolean;
    maxReconnectDelay: number;
    maxSeenEventIds: number;
    useDeviceProof: boolean;
    role: WsPeerRole;
    protocolRev: number;
  };

  private ws: WebSocket | null = null;
  private ready = false;
  private clientId: string | null = null;
  private seenEventIds = new Set<string>();
  private seenEventIdOrder: string[] = [];
  private pending = new Map<
    string,
    { resolve: (msg: WsResponseEnvelope) => void; reject: (err: Error) => void }
  >();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  constructor(options: TyrumClientOptions) {
    this.emitter = mitt<TyrumClientEvents>();
    this.opts = {
      useDeviceProof: false,
      role: "client",
      protocolRev: DEFAULT_PROTOCOL_REV,
      reconnect: true,
      maxReconnectDelay: DEFAULT_MAX_RECONNECT_DELAY,
      maxSeenEventIds: DEFAULT_MAX_SEEN_EVENT_IDS,
      ...options,
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Whether the underlying WebSocket is currently open. */
  get connected(): boolean {
    return (
      this.ws?.readyState === WebSocket.OPEN &&
      this.ready &&
      this.clientId !== null
    );
  }

  /** Subscribe to a typed event. */
  on<K extends keyof TyrumClientEvents>(
    event: K,
    handler: (data: TyrumClientEvents[K]) => void,
  ): void {
    this.emitter.on(event, handler);
  }

  /** Unsubscribe from a typed event. */
  off<K extends keyof TyrumClientEvents>(
    event: K,
    handler: (data: TyrumClientEvents[K]) => void,
  ): void {
    this.emitter.off(event, handler);
  }

  /** Open the WebSocket connection and send the `hello` handshake. */
  connect(): void {
    this.intentionalClose = false;
    this.openSocket();
  }

  /** Gracefully close the connection (no auto-reconnect). */
  disconnect(): void {
    this.intentionalClose = true;
    this.cancelReconnect();
    if (this.ws) {
      this.ws.close(1000, "client disconnect");
      this.ws = null;
    }
    this.ready = false;
    this.clientId = null;
    this.pending.clear();
  }

  /** Respond to a task.execute request from the gateway. */
  respondTaskExecute(
    requestId: string,
    success: boolean,
    result?: unknown,
    evidence?: unknown,
    error?: string,
  ): void {
    const response: WsResponseEnvelope = success
      ? {
          request_id: requestId,
          type: "task.execute",
          ok: true,
          result: WsTaskExecuteResult.parse({ result, evidence }),
        }
      : {
          request_id: requestId,
          type: "task.execute",
          ok: false,
          error: WsError.parse({
            code: "task_failed",
            message: error ?? "task failed",
            details: { evidence },
          }),
        };
    this.send(response);
  }

  /** Respond to an approval.request from the gateway. */
  respondApprovalRequest(
    requestId: string,
    approved: boolean,
    reason?: string,
  ): void {
    const response: WsResponseEnvelope = {
      request_id: requestId,
      type: "approval.request",
      ok: true,
      result: WsApprovalDecision.parse({ approved, reason }),
    };
    this.send(response);
  }

  /** List approvals via WS control-plane request (requires gateway support). */
  approvalList(payload: WsApprovalListPayload = { limit: 100 }): Promise<WsApprovalListResultT> {
    return this.request("approval.list", payload, WsApprovalListResult);
  }

  /** Resolve an approval via WS control-plane request (requires gateway support). */
  approvalResolve(payload: WsApprovalResolvePayload): Promise<WsApprovalResolveResultT> {
    return this.request("approval.resolve", payload, WsApprovalResolveResult);
  }

  /** Execute a slash-command via WS control-plane request (gateway-handled). */
  commandExecute(command: string): Promise<WsCommandExecuteResultT> {
    return this.request("command.execute", { command }, WsCommandExecuteResult);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private buildProtocols(): string[] {
    const token = toBase64UrlUtf8(this.opts.token);
    return [WS_BASE_PROTOCOL, `${WS_AUTH_PROTOCOL_PREFIX}${token}`];
  }

  private openSocket(): void {
    this.ready = false;
    this.clientId = null;

    this.ws = new WebSocket(this.opts.url, this.buildProtocols());

    this.ws.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.sendConnect();
    });

    this.ws.addEventListener("message", (event: MessageEvent) => {
      this.handleMessage(event.data as string);
    });

    this.ws.addEventListener("close", (event: CloseEvent) => {
      this.emitter.emit("disconnected", {
        code: event.code,
        reason: event.reason,
      });
      this.ws = null;
      this.ready = false;
      this.clientId = null;
      this.pending.clear();
      if (!this.intentionalClose && this.opts.reconnect) {
        this.scheduleReconnect();
      }
    });

    // WebSocket errors surface as a close event; absorb error to avoid unhandled throws.
    this.ws.addEventListener("error", () => {
      // close event will follow
    });
  }

  private sendConnect(): void {
    if (this.opts.useDeviceProof && this.opts.device) {
      void this.sendConnectWithDeviceProof();
      return;
    }
    this.sendLegacyConnect();
  }

  private sendLegacyConnect(): void {
    const requestId = crypto.randomUUID();

    const request: WsRequestEnvelope = {
      request_id: requestId,
      type: "connect",
      payload: { capabilities: this.opts.capabilities },
    };

    // connect is a request/response handshake; treat it as the gate for
    // emitting the `connected` event.
    this.pending.set(requestId, {
      resolve: (msg) => {
        if (!msg.ok) {
          this.disconnect();
          return;
        }
        const parsed = WsConnectResult.safeParse(msg.result ?? {});
        if (!parsed.success) {
          this.disconnect();
          return;
        }
        this.ready = true;
        this.clientId = parsed.data.client_id;
        this.emitter.emit("connected", { clientId: parsed.data.client_id });
      },
      reject: () => {
        this.disconnect();
      },
    });

    this.send(request);
  }

  private async sendConnectWithDeviceProof(): Promise<void> {
    try {
      const device = this.opts.device;
      if (!device) {
        this.sendLegacyConnect();
        return;
      }
      const pubkey = device.publicKey.trim();
      const privkey = device.privateKey.trim();
      if (!pubkey || !privkey) {
        this.disconnect();
        return;
      }

      const pubkeyDer = fromBase64Url(pubkey);
      const deviceId = device.deviceId?.trim() || (await computeDeviceId(pubkeyDer));
      const role = this.opts.role;
      const protocolRev = this.opts.protocolRev;

      const requestId = crypto.randomUUID();
      const request: WsRequestEnvelope = {
        request_id: requestId,
        type: "connect.init",
        payload: {
          protocol_rev: protocolRev,
          role,
          device: {
            device_id: deviceId,
            pubkey,
            label: device.label,
            platform: device.platform,
            version: device.version,
            mode: device.mode,
          },
          capabilities: this.opts.capabilities.map((id) => ({ id })),
        },
      };

      this.pending.set(requestId, {
        resolve: (msg) => {
          void this.handleConnectInitResponse(msg, {
            deviceId,
            role,
            protocolRev,
            privateKey: privkey,
          });
        },
        reject: () => this.disconnect(),
      });

      this.send(request);
    } catch {
      this.disconnect();
    }
  }

  private async handleConnectInitResponse(
    msg: WsResponseEnvelope,
    ctx: { deviceId: string; role: WsPeerRole; protocolRev: number; privateKey: string },
  ): Promise<void> {
    if (!msg.ok) {
      this.disconnect();
      return;
    }
    const parsed = WsConnectInitResult.safeParse(msg.result ?? {});
    if (!parsed.success) {
      this.disconnect();
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
      const signature = await signEd25519Pkcs8(fromBase64Url(ctx.privateKey), transcript);
      const proof = toBase64UrlBytes(signature);

      const requestId = crypto.randomUUID();
      const request: WsRequestEnvelope = {
        request_id: requestId,
        type: "connect.proof",
        payload: { connection_id: parsed.data.connection_id, proof },
      };

      this.pending.set(requestId, {
        resolve: (msg2) => {
          if (!msg2.ok) {
            this.disconnect();
            return;
          }
          const parsed2 = WsConnectProofResult.safeParse(msg2.result ?? {});
          if (!parsed2.success) {
            this.disconnect();
            return;
          }
          this.ready = true;
          this.clientId = parsed2.data.client_id;
          this.emitter.emit("connected", { clientId: parsed2.data.client_id });
        },
        reject: () => this.disconnect(),
      });

      this.send(request);
    } catch {
      this.disconnect();
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private request<T>(
    type: string,
    payload: unknown,
    schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: { message: string } } },
    timeoutMs = 30_000,
  ): Promise<T> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("WebSocket is not connected"));
    }
    if (!this.ready) {
      return Promise.reject(new Error("WebSocket handshake not completed"));
    }

    const requestId = crypto.randomUUID();
    const request: WsRequestEnvelope = { request_id: requestId, type, payload };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${type} timed out`));
      }, timeoutMs);

      this.pending.set(requestId, {
        resolve: (msg) => {
          clearTimeout(timer);
          if (!msg.ok) {
            reject(new Error(`${type} failed: ${msg.error.code}: ${msg.error.message}`));
            return;
          }
          const parsed = schema.safeParse(msg.result ?? {});
          if (!parsed.success) {
            reject(new Error(`${type} returned invalid result: ${parsed.error.message}`));
            return;
          }
          resolve(parsed.data);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.send(request);
    });
  }

  private handleMessage(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return; // silently ignore malformed frames
    }

    const parsed = WsMessageEnvelope.safeParse(json);
    if (!parsed.success) {
      return;
    }

    const msg = parsed.data;

    // Responses (to prior requests)
    if ("ok" in msg) {
      const pending = this.pending.get(msg.request_id);
      if (pending) {
        this.pending.delete(msg.request_id);
        pending.resolve(msg);
      }
      return;
    }

    // Events (server push)
    if ("event_id" in msg) {
      if (!this.markEventSeen(msg.event_id)) {
        return;
      }
      if (msg.type === "plan.update") {
        const evt = WsPlanUpdateEvent.safeParse(msg);
        if (evt.success) {
          this.emitter.emit("plan_update", evt.data);
        }
        return;
      }
      if (msg.type === "error") {
        const evt = WsErrorEvent.safeParse(msg);
        if (evt.success) {
          this.emitter.emit("error", evt.data);
        }
        return;
      }
      return;
    }

    // Requests (gateway -> client)
    switch (msg.type) {
      case "ping":
        // heartbeat: reply with an ok response
        this.send({
          request_id: msg.request_id,
          type: "ping",
          ok: true,
        } satisfies WsResponseEnvelope);
        return;

      case "task.execute": {
        const req = WsTaskExecuteRequest.safeParse(msg);
        if (req.success) {
          this.emitter.emit("task_execute", req.data);
        } else {
          this.send({
            request_id: msg.request_id,
            type: msg.type,
            ok: false,
            error: WsError.parse({
              code: "invalid_request",
              message: req.error.message,
              details: { issues: req.error.issues },
            }),
          } satisfies WsResponseEnvelope);
        }
        return;
      }

      case "approval.request": {
        const req = WsApprovalRequest.safeParse(msg);
        if (req.success) {
          this.emitter.emit("approval_request", req.data);
        } else {
          this.send({
            request_id: msg.request_id,
            type: msg.type,
            ok: false,
            error: WsError.parse({
              code: "invalid_request",
              message: req.error.message,
              details: { issues: req.error.issues },
            }),
          } satisfies WsResponseEnvelope);
        }
        return;
      }

      case "connect":
        // connect is client-initiated only
        this.send({
          request_id: msg.request_id,
          type: "connect",
          ok: false,
          error: { code: "unexpected_connect", message: "connect must be client-initiated" },
        } satisfies WsResponseEnvelope);
        return;

      case "connect.init":
      case "connect.proof":
        this.send({
          request_id: msg.request_id,
          type: msg.type,
          ok: false,
          error: { code: "unexpected_connect", message: `${msg.type} must be client-initiated` },
        } satisfies WsResponseEnvelope);
        return;
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      BASE_RECONNECT_DELAY * 2 ** this.reconnectAttempt,
      this.opts.maxReconnectDelay,
    );
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private markEventSeen(eventId: string): boolean {
    if (this.seenEventIds.has(eventId)) return false;

    this.seenEventIds.add(eventId);
    this.seenEventIdOrder.push(eventId);

    const max = Math.max(1, this.opts.maxSeenEventIds);
    while (this.seenEventIdOrder.length > max) {
      const oldest = this.seenEventIdOrder.shift();
      if (oldest) {
        this.seenEventIds.delete(oldest);
      }
    }

    return true;
  }
}
