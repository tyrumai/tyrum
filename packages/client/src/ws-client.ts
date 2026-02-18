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

import { GatewayMessage } from "@tyrum/schemas";
import type {
  ClientCapability,
  TaskDispatchMessage,
  HumanConfirmationMessage,
  PlanUpdateMessage,
  ErrorMessage,
} from "@tyrum/schemas";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type TyrumClientEvents = {
  connected: undefined;
  disconnected: { code: number; reason: string };
  task_dispatch: TaskDispatchMessage;
  human_confirmation: HumanConfirmationMessage;
  plan_update: PlanUpdateMessage;
  error: ErrorMessage;
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
    return this.ws?.readyState === WebSocket.OPEN;
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
  }

  /** Report a task execution result back to the gateway. */
  sendTaskResult(
    taskId: string,
    success: boolean,
    evidence?: unknown,
    error?: string,
  ): void {
    this.send({
      type: "task_result",
      task_id: taskId,
      success,
      evidence,
      error,
    });
  }

  /** Respond to a human confirmation request. */
  sendHumanResponse(
    planId: string,
    approved: boolean,
    reason?: string,
  ): void {
    this.send({
      type: "human_response",
      plan_id: planId,
      approved,
      reason,
    });
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private buildProtocols(): string[] {
    const token = toBase64UrlUtf8(this.opts.token);
    return [WS_BASE_PROTOCOL, `${WS_AUTH_PROTOCOL_PREFIX}${token}`];
  }

  private openSocket(): void {
    this.ws = new WebSocket(this.opts.url, this.buildProtocols());

    this.ws.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.sendHello();
      this.emitter.emit("connected", undefined);
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
      if (!this.intentionalClose && this.opts.reconnect) {
        this.scheduleReconnect();
      }
    });

    // WebSocket errors surface as a close event; absorb error to avoid unhandled throws.
    this.ws.addEventListener("error", () => {
      // close event will follow
    });
  }

  private sendHello(): void {
    this.send({
      type: "hello",
      capabilities: this.opts.capabilities,
    });
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

    const parsed = GatewayMessage.safeParse(json);
    if (!parsed.success) {
      return;
    }

    const msg = parsed.data;

    switch (msg.type) {
      case "ping":
        this.send({ type: "pong" });
        break;
      case "task_dispatch":
        this.emitter.emit("task_dispatch", msg);
        break;
      case "human_confirmation":
        this.emitter.emit("human_confirmation", msg);
        break;
      case "plan_update":
        this.emitter.emit("plan_update", msg);
        break;
      case "error":
        this.emitter.emit("error", msg);
        break;
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
