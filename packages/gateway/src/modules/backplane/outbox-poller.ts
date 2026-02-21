import type { WsEventEnvelope, WsRequestEnvelope } from "@tyrum/schemas";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { OutboxDal, OutboxRow } from "./outbox-dal.js";
import { GATEWAY_EVENT_TOPIC } from "./event-publisher.js";
import type { EventConsumer } from "./event-consumer.js";

export interface OutboxPollerOptions {
  consumerId: string;
  outboxDal: OutboxDal;
  connectionManager: ConnectionManager;
  pollIntervalMs?: number;
  batchSize?: number;
  onGatewayEvent?: (event: unknown) => void | Promise<void>;
  eventConsumer?: EventConsumer;
}

type WsEnvelope = WsEventEnvelope | WsRequestEnvelope;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function parseDirectPayload(payload: unknown): { connection_id: string; message: WsEnvelope } | undefined {
  if (!isObject(payload)) return undefined;
  const connectionId = payload["connection_id"];
  const message = payload["message"];
  if (typeof connectionId !== "string") return undefined;
  if (!isObject(message)) return undefined;
  return { connection_id: connectionId, message: message as WsEnvelope };
}

function parseBroadcastPayload(
  payload: unknown,
): { message: WsEnvelope; source_edge_id?: string; skip_local?: boolean } | undefined {
  if (!isObject(payload)) return undefined;

  const maybeMessage = payload["message"];
  if (isObject(maybeMessage)) {
    const sourceEdgeId = payload["source_edge_id"];
    const skipLocal = payload["skip_local"];
    return {
      message: maybeMessage as WsEnvelope,
      source_edge_id: typeof sourceEdgeId === "string" ? sourceEdgeId : undefined,
      skip_local: typeof skipLocal === "boolean" ? skipLocal : undefined,
    };
  }

  // Back-compat: allow the envelope itself as the payload.
  return { message: payload as WsEnvelope };
}

export class OutboxPoller {
  private readonly consumerId: string;
  private readonly outboxDal: OutboxDal;
  private readonly connectionManager: ConnectionManager;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly onGatewayEvent?: (event: unknown) => void | Promise<void>;
  private readonly eventConsumer?: EventConsumer;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(opts: OutboxPollerOptions) {
    this.consumerId = opts.consumerId;
    this.outboxDal = opts.outboxDal;
    this.connectionManager = opts.connectionManager;
    this.pollIntervalMs = opts.pollIntervalMs ?? 500;
    this.batchSize = opts.batchSize ?? 200;
    this.onGatewayEvent = opts.onGatewayEvent;
    this.eventConsumer = opts.eventConsumer;
  }

  start(): void {
    if (this.timer) return;
    void this.outboxDal.ensureConsumer(this.consumerId);
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const rows = await this.outboxDal.poll(this.consumerId, this.batchSize);
    if (rows.length === 0) return;

    for (const row of rows) {
      try {
        this.processRow(row);
      } catch {
        // Best-effort delivery: don't wedge the consumer.
      } finally {
        await this.outboxDal.ackConsumerCursor(this.consumerId, row.id);
      }
    }
    } finally {
      this.ticking = false;
    }
  }

  private processRow(row: OutboxRow): void {
    // Consumer-side deduplication by event_id
    if (this.eventConsumer) {
      const eventId = extractEventId(row);
      if (eventId && this.eventConsumer.isDuplicate(eventId)) return;
    }

    if (row.topic === "ws.broadcast") {
      const parsed = parseBroadcastPayload(row.payload);
      if (!parsed) return;
      if (parsed.skip_local && parsed.source_edge_id === this.consumerId) return;

      const payload = JSON.stringify(parsed.message);
      for (const client of this.connectionManager.allClients()) {
        client.ws.send(payload);
      }
      return;
    }

    if (row.topic === "ws.direct") {
      const parsed = parseDirectPayload(row.payload);
      if (!parsed) return;
      const client = this.connectionManager.getClient(parsed.connection_id);
      if (!client) return;
      client.ws.send(JSON.stringify(parsed.message));
      return;
    }

    if (row.topic === GATEWAY_EVENT_TOPIC) {
      void this.onGatewayEvent?.(row.payload);
      return;
    }
  }
}

/** Extract event_id from an outbox row payload for deduplication. */
function extractEventId(row: OutboxRow): string | undefined {
  if (!isObject(row.payload)) return undefined;

  // ws.broadcast / ws.direct: event_id is inside the nested message envelope
  const message = row.payload["message"];
  if (isObject(message)) {
    const eventId = message["event_id"];
    if (typeof eventId === "string") return eventId;
  }

  // gateway.event: event_id is at the top level
  const eventId = row.payload["event_id"];
  if (typeof eventId === "string") return eventId;

  return undefined;
}

