import type { Emitter } from "mitt";
import * as mittNs from "mitt";

import type { WsEvent as WsEventT, WsRequestEnvelope, WsResponseEnvelope } from "@tyrum/schemas";
import {
  WsError,
  WsEvent,
  WsMessageEnvelope,
  WsTaskExecuteRequest,
  WsTaskExecuteResult,
} from "@tyrum/schemas";

import type {
  ResolvedTyrumClientOptions,
  TyrumClientEvents,
  TyrumClientOptions,
  TyrumClientProtocolErrorInfo,
  TyrumClientProtocolErrorKind,
} from "./ws-client.types.js";

const mitt = (typeof mittNs.default === "function" ? mittNs.default : mittNs) as unknown as <
  T extends Record<string, unknown>,
>() => Emitter<T>;

const DEFAULT_MAX_RECONNECT_DELAY = 30_000;
const DEFAULT_RECONNECT_BASE_DELAY = 5_000;
const DEFAULT_MAX_SEEN_EVENT_IDS = 1_000;
const DEFAULT_MAX_SEEN_REQUEST_IDS = 1_000;
const DEFAULT_PROTOCOL_ERROR_REPORT_INTERVAL_MS = 5_000;
const MAX_PROTOCOL_ERROR_RAW_LENGTH = 512;
const DEFAULT_PROTOCOL_REV = 2;

const WS_ACK_RESULT = {
  safeParse: (
    input: unknown,
  ):
    | { success: true; data: void }
    | {
        success: false;
        error: { message: string };
      } => {
    if (input === undefined) {
      return { success: true, data: undefined };
    }
    if (
      typeof input === "object" &&
      input !== null &&
      !Array.isArray(input) &&
      Object.keys(input).length === 0
    ) {
      return { success: true, data: undefined };
    }
    return {
      success: false,
      error: { message: "expected an empty result" },
    };
  },
};

type PendingRequest = {
  resolve: (msg: WsResponseEnvelope) => void;
  reject: (err: Error) => void;
};

type SafeParseSchema<T> = {
  safeParse: (
    input: unknown,
  ) =>
    | { success: true; data: T }
    | { success: false; error: { message: string; issues?: unknown } };
};

function truncateProtocolErrorRaw(raw: string): string {
  if (raw.length <= MAX_PROTOCOL_ERROR_RAW_LENGTH) {
    return raw;
  }
  const suffix = `... [truncated ${raw.length - MAX_PROTOCOL_ERROR_RAW_LENGTH} chars]`;
  return `${raw.slice(0, MAX_PROTOCOL_ERROR_RAW_LENGTH)}${suffix}`;
}

export abstract class TyrumClientProtocolCore {
  protected readonly emitter: Emitter<TyrumClientEvents>;
  protected readonly opts: ResolvedTyrumClientOptions;
  protected ws: WebSocket | null = null;
  protected ready = false;
  protected clientId: string | null = null;
  protected seenEventIds = new Set<string>();
  protected seenEventIdOrder: string[] = [];
  protected inboundRequestInFlight = new Set<string>();
  protected inboundRequestResponses = new Map<string, WsResponseEnvelope>();
  protected pending = new Map<string, PendingRequest>();
  protected reconnectAttempt = 0;
  protected reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  protected intentionalClose = false;
  protected connectionAttempt = 0;
  protected transportErrorHint: string | null = null;
  protected suppressReconnect = false;
  protected suppressedProtocolErrors = 0;
  protected nextProtocolErrorReportAtMs = 0;

  public constructor(options: TyrumClientOptions) {
    this.emitter = mitt<TyrumClientEvents>();
    this.opts = {
      debugProtocol: false,
      role: "client",
      protocolRev: DEFAULT_PROTOCOL_REV,
      reconnect: true,
      reconnectBaseDelayMs: DEFAULT_RECONNECT_BASE_DELAY,
      maxReconnectDelay: DEFAULT_MAX_RECONNECT_DELAY,
      maxSeenEventIds: DEFAULT_MAX_SEEN_EVENT_IDS,
      maxSeenRequestIds: DEFAULT_MAX_SEEN_REQUEST_IDS,
      ...options,
    };
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.ready && this.clientId !== null;
  }

  on<K extends keyof TyrumClientEvents>(
    event: K,
    handler: (data: TyrumClientEvents[K]) => void,
  ): void {
    this.emitter.on(event, handler);
  }

  off<K extends keyof TyrumClientEvents>(
    event: K,
    handler: (data: TyrumClientEvents[K]) => void,
  ): void {
    this.emitter.off(event, handler);
  }

  connect(): void {
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.cancelReconnect();
    if (this.ws) {
      this.ws.close(1000, "client disconnect");
      this.ws = null;
    }
    this.ready = false;
    this.clientId = null;
    this.rejectPending(new Error("WebSocket disconnected"));
  }

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
    this.cacheInboundRequestResponse("task.execute", requestId, response);
    this.send(response);
  }

  protected abstract openSocket(): void;

  protected parsePayload<T>(type: string, payload: unknown, schema: SafeParseSchema<T>): T {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(`${type} invalid payload: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  protected send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  protected request<T>(
    type: string,
    payload: unknown,
    schema: SafeParseSchema<T>,
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
          if (msg.type !== type) {
            reject(new Error(`${type} failed: mismatched response type ${msg.type}`));
            return;
          }
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

  protected requestVoid(type: string, payload: unknown): Promise<void> {
    return this.request(type, payload, WS_ACK_RESULT);
  }

  protected resetProtocolErrorReporting(): void {
    this.suppressedProtocolErrors = 0;
    this.nextProtocolErrorReportAtMs = 0;
  }

  protected handleMessage(raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      this.reportProtocolError(
        "invalid_json",
        raw,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    const parsed = WsMessageEnvelope.safeParse(json);
    if (!parsed.success) {
      this.reportProtocolError("invalid_envelope", raw, parsed.error.message);
      return;
    }

    const msg = parsed.data;
    if ("ok" in msg) {
      const pending = this.pending.get(msg.request_id);
      if (pending) {
        this.pending.delete(msg.request_id);
        pending.resolve(msg);
      }
      return;
    }

    if ("event_id" in msg) {
      if (!this.markEventSeen(msg.event_id)) {
        return;
      }
      const evt = WsEvent.safeParse(msg);
      if (evt.success) {
        this.emitProtocolEvent(evt.data);
      }
      return;
    }

    switch (msg.type) {
      case "ping":
        this.send({
          request_id: msg.request_id,
          type: "ping",
          ok: true,
        } satisfies WsResponseEnvelope);
        return;
      case "task.execute":
        this.handleInboundClientRequest(
          msg.type,
          msg.request_id,
          msg,
          WsTaskExecuteRequest,
          "task_execute",
        );
        return;
      case "connect":
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

  protected scheduleReconnect(): void {
    const attempt = this.reconnectAttempt + 1;
    const maxReconnectDelayMs = Math.max(0, this.opts.maxReconnectDelay);
    const reconnectBaseDelayMs = Math.max(0, this.opts.reconnectBaseDelayMs);
    const backoffDelayMs = Math.min(maxReconnectDelayMs, reconnectBaseDelayMs * 2 ** (attempt - 1));
    const delay = Math.min(backoffDelayMs, Math.floor(Math.random() * (backoffDelayMs + 1)));
    const nextRetryAtMs = Date.now() + delay;
    this.reconnectAttempt += 1;
    this.emitter.emit("reconnect_scheduled", { delayMs: delay, nextRetryAtMs, attempt });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  protected cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  protected rejectPending(err: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(err);
    }
    this.pending.clear();
  }

  private emitProtocolEvent(event: WsEventT): void {
    const eventType = event.type;
    this.emitter.emit(eventType, event);
    if (eventType === "plan.update") {
      this.emitter.emit("plan_update", event);
    }
  }

  private warnProtocolError(info: TyrumClientProtocolErrorInfo, rawLength: number): void {
    const errorSuffix = info.error ? ` (${info.error})` : "";
    const suppressedSuffix =
      info.suppressedCount > 0
        ? `; suppressed ${info.suppressedCount} similar frame${
            info.suppressedCount === 1 ? "" : "s"
          }`
        : "";
    console.warn(
      `[TyrumClient] protocol error ${info.kind}${suppressedSuffix}; raw_length=${rawLength}${errorSuffix}`,
    );
  }

  private reportProtocolError(
    kind: TyrumClientProtocolErrorKind,
    raw: string,
    error?: string,
  ): void {
    const now = Date.now();
    if (now < this.nextProtocolErrorReportAtMs) {
      this.suppressedProtocolErrors += 1;
      return;
    }

    const rawLength = raw.length;
    const info: TyrumClientProtocolErrorInfo = {
      kind,
      raw: truncateProtocolErrorRaw(raw),
      error: typeof error === "string" && error.trim().length > 0 ? error : undefined,
      suppressedCount: this.suppressedProtocolErrors,
    };

    this.suppressedProtocolErrors = 0;
    this.nextProtocolErrorReportAtMs = now + DEFAULT_PROTOCOL_ERROR_REPORT_INTERVAL_MS;
    this.emitter.emit("protocol_error", info);
    this.opts.onProtocolError?.(info);
    if (this.opts.debugProtocol) {
      this.warnProtocolError(info, rawLength);
    }
  }

  private handleInboundClientRequest<T>(
    type: "task.execute",
    requestId: string,
    msg: unknown,
    schema: SafeParseSchema<T>,
    eventName: "task_execute",
  ): void {
    const cached = this.getCachedInboundRequestResponse(type, requestId);
    if (cached) {
      this.send(cached);
      return;
    }
    if (!this.markInboundRequestPending(type, requestId)) {
      return;
    }

    const req = schema.safeParse(msg);
    if (req.success) {
      this.emitter.emit(eventName, req.data as TyrumClientEvents[typeof eventName]);
      return;
    }

    const response: WsResponseEnvelope = {
      request_id: requestId,
      type,
      ok: false,
      error: WsError.parse({
        code: "invalid_request",
        message: req.error.message,
        details: { issues: req.error.issues },
      }),
    };
    this.cacheInboundRequestResponse(type, requestId, response);
    this.send(response);
  }

  private inboundRequestKey(type: string, requestId: string): string {
    return `${type}:${requestId}`;
  }

  private evictInboundRequestResponses(): void {
    const max = Math.max(1, this.opts.maxSeenRequestIds);
    while (this.inboundRequestResponses.size > max) {
      const oldest = this.inboundRequestResponses.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      this.inboundRequestResponses.delete(oldest);
    }
  }

  private markInboundRequestPending(type: string, requestId: string): boolean {
    const key = this.inboundRequestKey(type, requestId);
    if (this.inboundRequestInFlight.has(key)) {
      return false;
    }
    this.inboundRequestInFlight.add(key);
    return true;
  }

  private cacheInboundRequestResponse(
    type: string,
    requestId: string,
    response: WsResponseEnvelope,
  ): void {
    const key = this.inboundRequestKey(type, requestId);
    this.inboundRequestInFlight.delete(key);
    this.inboundRequestResponses.delete(key);
    this.inboundRequestResponses.set(key, response);
    this.evictInboundRequestResponses();
  }

  private getCachedInboundRequestResponse(
    type: string,
    requestId: string,
  ): WsResponseEnvelope | undefined {
    const key = this.inboundRequestKey(type, requestId);
    const existing = this.inboundRequestResponses.get(key);
    if (existing !== undefined) {
      this.inboundRequestResponses.delete(key);
      this.inboundRequestResponses.set(key, existing);
    }
    return existing;
  }

  private markEventSeen(eventId: string): boolean {
    if (this.seenEventIds.has(eventId)) {
      return false;
    }

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
