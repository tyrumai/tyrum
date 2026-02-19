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
import {
  WsApprovalDecision,
  WsApprovalRequest,
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
  /** Whether to auto-reconnect on unexpected close. Defaults to `true`. */
  reconnect?: boolean;
  /** Upper bound for reconnect backoff delay in milliseconds. Defaults to 30 000. */
  maxReconnectDelay?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;
const WS_BASE_PROTOCOL = "tyrum-v1";
const WS_AUTH_PROTOCOL_PREFIX = "tyrum-auth.";

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
  private readonly opts: Required<TyrumClientOptions>;

  private ws: WebSocket | null = null;
  private ready = false;
  private clientId: string | null = null;
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
      reconnect: true,
      maxReconnectDelay: DEFAULT_MAX_RECONNECT_DELAY,
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
}
