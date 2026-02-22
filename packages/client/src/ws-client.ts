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
import type { PeerRole } from "@tyrum/schemas";
import {
  WS_PROTOCOL_REV,
  WsApprovalDecision,
  WsApprovalRequest,
  WsConnectInitResult,
  WsError,
  WsErrorEvent,
  WsMessageEnvelope,
  WsPairingApprovedEvent,
  WsPlanUpdateEvent,
  WsPairingApproveResult,
  WsPairingDenyResult,
  WsPairingRevokeResult,
  WsSessionSendResult,
  WsTaskExecuteRequest,
  WsTaskExecuteResult,
  WsWorkflowRunResult,
  base32Encode,
} from "@tyrum/schemas";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type TyrumClientEvents = {
  connected: { connectionId: string; instanceId: string; role: PeerRole };
  disconnected: { code: number; reason: string };
  task_execute: WsTaskExecuteRequest;
  approval_request: WsApprovalRequest;
  pairing_approved: WsPairingApprovedEvent;
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
   * Optional home directory for persisting device identity in Node runtimes.
   * Defaults to `process.env.TYRUM_HOME` or `~/.tyrum`.
   */
  tyrumHome?: string;
  /** Peer role advertised during handshake. Defaults to `"client"`. */
  role?: PeerRole;
  /** Optional human-friendly device label (used for presence). */
  deviceLabel?: string;
  /** Optional platform string (used for presence/debug). */
  devicePlatform?: string;
  /** Whether to auto-reconnect on unexpected close. Defaults to `true`. */
  reconnect?: boolean;
  /** Upper bound for reconnect backoff delay in milliseconds. Defaults to 30 000. */
  maxReconnectDelay?: number;
}

type ResolvedTyrumClientOptions = Omit<
  TyrumClientOptions,
  "reconnect" | "maxReconnectDelay" | "role"
> & {
  reconnect: boolean;
  maxReconnectDelay: number;
  role: PeerRole;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;
const WS_BASE_PROTOCOL = "tyrum-v1";
const WS_AUTH_PROTOCOL_PREFIX = "tyrum-auth.";
const ED25519_SPKI_PREFIX_HEX = "302a300506032b6570032100";
const EVENT_ID_DEDUPE_MAX = 2_000;
const EVENT_ID_DEDUPE_TTL_MS = 10 * 60_000;

function extractEd25519RawPublicKeyFromSpki(spkiDer: Uint8Array): Uint8Array {
  const prefix = Buffer.from(ED25519_SPKI_PREFIX_HEX, "hex");
  const spkiBuf = Buffer.from(spkiDer);
  if (
    spkiBuf.length !== prefix.length + 32 ||
    !spkiBuf.subarray(0, prefix.length).equals(prefix)
  ) {
    throw new Error("unexpected ed25519 spki encoding");
  }
  return spkiBuf.subarray(prefix.length);
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

function fromBase64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padding);

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(padded, "base64"));
  }

  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function isNodeRuntime(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof (process as unknown as { versions?: { node?: string } }).versions?.node === "string"
  );
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  if (isNodeRuntime()) {
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(data).digest();
    return new Uint8Array(digest);
  }

  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      data as unknown as BufferSource,
    );
    return new Uint8Array(digest);
  }

  throw new Error("sha256 is unavailable in this runtime");
}

async function deriveDeviceId(pubkeyRaw: Uint8Array): Promise<string> {
  const digest = await sha256Bytes(pubkeyRaw);
  return `dev-${base32Encode(digest)}`;
}

function handshakeTranscript(params: {
  protocolRev: number;
  role: PeerRole;
  deviceId: string;
  challenge: string;
}): Uint8Array {
  const transcript =
    `tyrum-handshake-v1|${params.protocolRev}|${params.role}|${params.deviceId}|${params.challenge}`;
  return new TextEncoder().encode(transcript);
}

interface DeviceIdentity {
  device_id: string;
  pubkey: string;
  label?: string;
  platform?: string;
  sign: (data: Uint8Array) => Promise<string>;
}

interface StoredDeviceKeyV1 {
  v: 1;
  device_id: string;
  spki_der_b64url: string;
  pkcs8_der_b64url: string;
  created_at: string;
}

function parseStoredKey(raw: unknown): StoredDeviceKeyV1 | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (r["v"] !== 1) return undefined;
  if (typeof r["device_id"] !== "string") return undefined;
  if (typeof r["spki_der_b64url"] !== "string") return undefined;
  if (typeof r["pkcs8_der_b64url"] !== "string") return undefined;
  if (typeof r["created_at"] !== "string") return undefined;
  return {
    v: 1,
    device_id: r["device_id"],
    spki_der_b64url: r["spki_der_b64url"],
    pkcs8_der_b64url: r["pkcs8_der_b64url"],
    created_at: r["created_at"],
  };
}

async function loadOrCreateNodeDeviceIdentity(params: {
  tyrumHome?: string;
  label?: string;
  platform?: string;
}): Promise<DeviceIdentity> {
  const { mkdir, readFile, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  const {
    createPrivateKey,
    createPublicKey,
    generateKeyPairSync,
    sign,
  } = await import("node:crypto");

  const tyrumHome =
    params.tyrumHome?.trim() ||
    process.env["TYRUM_HOME"]?.trim() ||
    join(homedir(), ".tyrum");
  await mkdir(tyrumHome, { recursive: true });
  const keyPath = join(tyrumHome, "device-ed25519.json");

  let stored: StoredDeviceKeyV1 | undefined;
  try {
    const raw = JSON.parse(await readFile(keyPath, "utf-8")) as unknown;
    stored = parseStoredKey(raw);
  } catch {
    stored = undefined;
  }

  let spkiDer: Uint8Array;
  let pkcs8Der: Uint8Array;
  let deviceId: string;
  let pubkeyRaw: Uint8Array | undefined;
  let derivedId: string | undefined;

  if (stored) {
    spkiDer = fromBase64UrlBytes(stored.spki_der_b64url);
    pkcs8Der = fromBase64UrlBytes(stored.pkcs8_der_b64url);
    deviceId = stored.device_id;
  } else {
    const kp = generateKeyPairSync("ed25519");
    const spki = kp.publicKey.export({ format: "der", type: "spki" }) as Uint8Array;
    const pkcs8 = kp.privateKey.export({ format: "der", type: "pkcs8" }) as Uint8Array;
    spkiDer = spki;
    pkcs8Der = pkcs8;

    pubkeyRaw = extractEd25519RawPublicKeyFromSpki(spkiDer);
    deviceId = await deriveDeviceId(pubkeyRaw);
    derivedId = deviceId;

    const record: StoredDeviceKeyV1 = {
      v: 1,
      device_id: deviceId,
      spki_der_b64url: toBase64UrlBytes(spkiDer),
      pkcs8_der_b64url: toBase64UrlBytes(pkcs8Der),
      created_at: new Date().toISOString(),
    };
    await writeFile(keyPath, JSON.stringify(record, null, 2) + "\n", {
      mode: 0o600,
    });
  }

  pubkeyRaw ??= extractEd25519RawPublicKeyFromSpki(spkiDer);
  derivedId ??= await deriveDeviceId(pubkeyRaw);
  if (derivedId !== deviceId) {
    throw new Error("stored device_id does not match derived pubkey hash");
  }

  const privateKey = createPrivateKey({ key: Buffer.from(pkcs8Der), format: "der", type: "pkcs8" });
  // Validate the key shape early.
  void createPublicKey({ key: Buffer.from(spkiDer), format: "der", type: "spki" });

  return {
    device_id: deviceId,
    pubkey: toBase64UrlBytes(pubkeyRaw),
    label: params.label,
    platform: params.platform,
    sign: async (data) => {
      const sig = sign(null, Buffer.from(data), privateKey);
      return toBase64UrlBytes(new Uint8Array(sig));
    },
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class TyrumClient {
  private readonly emitter: Emitter<TyrumClientEvents>;
  private opts: ResolvedTyrumClientOptions;

  private ws: WebSocket | null = null;
  private ready = false;
  private connectionId: string | null = null;
  private instanceId: string | null = null;
  private identityPromise: Promise<DeviceIdentity> | null = null;
  private pending = new Map<
    string,
    { resolve: (msg: WsResponseEnvelope) => void; reject: (err: Error) => void }
  >();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private readonly recentEventIds = new Map<string, number>();

  constructor(options: TyrumClientOptions) {
    this.emitter = mitt<TyrumClientEvents>();
    this.opts = {
      ...options,
      reconnect: options.reconnect ?? true,
      maxReconnectDelay: options.maxReconnectDelay ?? DEFAULT_MAX_RECONNECT_DELAY,
      role: options.role ?? "client",
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
      this.connectionId !== null &&
      this.instanceId !== null
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

  /**
   * Update the auth token used for future connections (including auto-reconnects).
   *
   * Does not affect the currently-open socket; callers should rely on a reconnect
   * to apply the new token.
   */
  setToken(token: string): void {
    this.opts.token = token;
  }

  /** Gracefully close the connection (no auto-reconnect). */
  disconnect(): void {
    this.intentionalClose = true;
    this.cancelReconnect();
    for (const pending of this.pending.values()) {
      pending.reject(new Error("client disconnect"));
    }
    const ws = this.ws;
    if (ws) {
      try {
        ws.close(1000, "client disconnect");
      } catch {
        // ignore
      }
    }
    this.ready = false;
    this.connectionId = null;
    this.instanceId = null;
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

  /** Send a chat message into a session (session.send) and return the agent reply. */
  async sessionSend(payload: {
    channel: string;
    thread_id: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    reply: string;
    session_id: string;
    used_tools: string[];
    memory_written: boolean;
  }> {
    const resp = await this.request("session.send", payload);
    if (!resp.ok) {
      throw new Error(`${resp.type} failed: ${resp.error.code}: ${resp.error.message}`);
    }
    const parsed = WsSessionSendResult.safeParse(resp.result ?? {});
    if (!parsed.success) {
      throw new Error(`invalid ${resp.type} result: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  /** Start a deterministic workflow run (workflow.run). */
  async workflowRun(payload: {
    key: string;
    lane: string;
    pipeline: string;
  }): Promise<{
    job_id: string;
    run_id: string;
    plan_id: string;
  }> {
    const resp = await this.request("workflow.run", payload);
    if (!resp.ok) {
      throw new Error(`${resp.type} failed: ${resp.error.code}: ${resp.error.message}`);
    }
    const parsed = WsWorkflowRunResult.safeParse(resp.result ?? {});
    if (!parsed.success) {
      throw new Error(`invalid ${resp.type} result: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  /** Approve a pending node pairing request (pairing.approve). */
  async pairingApprove(payload: { node_id: string; reason?: string }): Promise<{
    pairing: unknown;
  }> {
    const resp = await this.request("pairing.approve", payload);
    if (!resp.ok) {
      throw new Error(`${resp.type} failed: ${resp.error.code}: ${resp.error.message}`);
    }
    const parsed = WsPairingApproveResult.safeParse(resp.result ?? {});
    if (!parsed.success) {
      throw new Error(`invalid ${resp.type} result: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  /** Deny a pending node pairing request (pairing.deny). */
  async pairingDeny(payload: { node_id: string; reason?: string }): Promise<{
    pairing: unknown;
  }> {
    const resp = await this.request("pairing.deny", payload);
    if (!resp.ok) {
      throw new Error(`${resp.type} failed: ${resp.error.code}: ${resp.error.message}`);
    }
    const parsed = WsPairingDenyResult.safeParse(resp.result ?? {});
    if (!parsed.success) {
      throw new Error(`invalid ${resp.type} result: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  /** Revoke an existing node pairing (pairing.revoke). */
  async pairingRevoke(payload: { node_id: string; reason?: string }): Promise<{
    pairing: unknown;
  }> {
    const resp = await this.request("pairing.revoke", payload);
    if (!resp.ok) {
      throw new Error(`${resp.type} failed: ${resp.error.code}: ${resp.error.message}`);
    }
    const parsed = WsPairingRevokeResult.safeParse(resp.result ?? {});
    if (!parsed.success) {
      throw new Error(`invalid ${resp.type} result: ${parsed.error.message}`);
    }
    return parsed.data;
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
    this.connectionId = null;
    this.instanceId = null;

    const ws = new WebSocket(this.opts.url, this.buildProtocols());
    this.ws = ws;

    ws.addEventListener("open", () => {
      if (this.ws !== ws) return;
      this.reconnectAttempt = 0;
      void this.startHandshake();
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      if (this.ws !== ws) return;
      this.handleMessage(event.data as string);
    });

    ws.addEventListener("close", (event: CloseEvent) => {
      if (this.ws !== ws) return;
      this.emitter.emit("disconnected", {
        code: event.code,
        reason: event.reason,
      });
      this.ws = null;
      this.ready = false;
      this.connectionId = null;
      this.instanceId = null;
      for (const pending of this.pending.values()) {
        pending.reject(new Error("socket closed"));
      }
      this.pending.clear();
      if (!this.intentionalClose && this.opts.reconnect) {
        this.scheduleReconnect();
      }
    });

    // WebSocket errors surface as a close event; absorb error to avoid unhandled throws.
    ws.addEventListener("error", () => {
      // close event will follow
    });
  }

  private request(type: string, payload: unknown): Promise<WsResponseEnvelope> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("socket is not open"));
    }

    const requestId = crypto.randomUUID();
    const request: WsRequestEnvelope = { request_id: requestId, type, payload };

    return new Promise<WsResponseEnvelope>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.send(request);
    });
  }

  private async getDeviceIdentity(): Promise<DeviceIdentity> {
    if (this.identityPromise) return this.identityPromise;

    const p = (async (): Promise<DeviceIdentity> => {
      if (isNodeRuntime()) {
        return await loadOrCreateNodeDeviceIdentity({
          tyrumHome: this.opts.tyrumHome,
          label: this.opts.deviceLabel,
          platform: this.opts.devicePlatform,
        });
      }

      // Browser / non-node runtimes: best-effort ephemeral identity.
      if (!globalThis.crypto?.subtle) {
        throw new Error("WebCrypto is required for Tyrum device identity in this runtime");
      }

      // Ed25519 WebCrypto support varies; fail loudly if unsupported.
      const keyPair = (await globalThis.crypto.subtle.generateKey(
        { name: "Ed25519" } as AlgorithmIdentifier,
        true,
        ["sign", "verify"],
      )) as CryptoKeyPair;
      const pubkeyRaw = new Uint8Array(
        await globalThis.crypto.subtle.exportKey("raw", keyPair.publicKey),
      );
      const deviceId = await deriveDeviceId(pubkeyRaw);

      return {
        device_id: deviceId,
        pubkey: toBase64UrlBytes(pubkeyRaw),
        label: this.opts.deviceLabel,
        platform: this.opts.devicePlatform,
        sign: async (data) => {
          const sig = await globalThis.crypto.subtle.sign(
            { name: "Ed25519" } as AlgorithmIdentifier,
            keyPair.privateKey,
            data as unknown as BufferSource,
          );
          return toBase64UrlBytes(new Uint8Array(sig));
        },
      };
    })();

    this.identityPromise = p;
    void p.catch(() => {
      if (this.identityPromise === p) {
        this.identityPromise = null;
      }
    });
    return p;
  }

  private async startHandshake(): Promise<void> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    try {
      const identity = await this.getDeviceIdentity();

      const initResp = await this.request("connect.init", {
        protocol_rev: WS_PROTOCOL_REV,
        role: this.opts.role,
        device: {
          device_id: identity.device_id,
          pubkey: identity.pubkey,
          label: identity.label,
          platform: identity.platform,
        },
        capabilities: this.opts.capabilities.map((c) => ({ name: c })),
      });

      if (!initResp.ok) {
        throw new Error(`connect.init failed: ${initResp.error.code}: ${initResp.error.message}`);
      }

      const initParsed = WsConnectInitResult.safeParse(initResp.result ?? {});
      if (!initParsed.success) {
        throw new Error(`invalid connect.init result: ${initParsed.error.message}`);
      }

      const { connection_id, challenge } = initParsed.data;
      const transcript = handshakeTranscript({
        protocolRev: WS_PROTOCOL_REV,
        role: this.opts.role,
        deviceId: identity.device_id,
        challenge,
      });
      const proof = await identity.sign(transcript);

      const proofResp = await this.request("connect.proof", {
        connection_id,
        proof,
      });

      if (!proofResp.ok) {
        throw new Error(`connect.proof failed: ${proofResp.error.code}: ${proofResp.error.message}`);
      }

      this.ready = true;
      this.connectionId = connection_id;
      this.instanceId = identity.device_id;
      this.emitter.emit("connected", {
        connectionId: connection_id,
        instanceId: identity.device_id,
        role: this.opts.role,
      });
    } catch {
      // If the socket closed (or was replaced) during handshake, the close handler
      // already schedules reconnect. Calling disconnect() here would set
      // intentionalClose and cancel auto-reconnect.
      if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        ws.close(4000, "handshake failed");
      } catch {
      }
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
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
      if (this.shouldDropEvent(msg.event_id)) {
        return;
      }
      if (msg.type === "pairing.approved") {
        const evt = WsPairingApprovedEvent.safeParse(msg);
        if (evt.success) {
          this.emitter.emit("pairing_approved", evt.data);
        }
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

      case "connect.init":
      case "connect.proof":
        // handshake is client-initiated only
        this.send({
          request_id: msg.request_id,
          type: msg.type,
          ok: false,
          error: { code: "unexpected_handshake", message: "handshake must be client-initiated" },
        } satisfies WsResponseEnvelope);
        return;
    }
  }

  private shouldDropEvent(eventId: string): boolean {
    const nowMs = Date.now();
    const cutoff = nowMs - EVENT_ID_DEDUPE_TTL_MS;
    for (const [id, ts] of this.recentEventIds) {
      if (ts >= cutoff) break;
      this.recentEventIds.delete(id);
    }

    if (this.recentEventIds.has(eventId)) {
      return true;
    }

    this.recentEventIds.set(eventId, nowMs);
    if (this.recentEventIds.size > EVENT_ID_DEDUPE_MAX) {
      const first = this.recentEventIds.keys().next().value as string | undefined;
      if (first) {
        this.recentEventIds.delete(first);
      }
    }

    return false;
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
}
