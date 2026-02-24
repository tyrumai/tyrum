import type { WsEventEnvelope, WsRequestEnvelope } from "@tyrum/schemas";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { OutboxDal, OutboxRow } from "./outbox-dal.js";
import type { Logger } from "../observability/logger.js";

export interface OutboxPollerOptions {
  consumerId: string;
  outboxDal: OutboxDal;
  connectionManager: ConnectionManager;
  logger?: Logger;
  pollIntervalMs?: number;
  batchSize?: number;
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

function extractAttemptId(message: WsEnvelope): string | undefined {
  if (message.type !== "task.execute") return undefined;
  const payload = (message as unknown as { payload?: unknown }).payload;
  if (!isObject(payload)) return undefined;
  const attemptId = payload["attempt_id"];
  return typeof attemptId === "string" && attemptId.trim().length > 0 ? attemptId : undefined;
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
  private readonly logger?: Logger;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(opts: OutboxPollerOptions) {
    this.consumerId = opts.consumerId;
    this.outboxDal = opts.outboxDal;
    this.connectionManager = opts.connectionManager;
    this.logger = opts.logger;
    this.pollIntervalMs = opts.pollIntervalMs ?? 500;
    this.batchSize = opts.batchSize ?? 200;
  }

  start(): void {
    if (this.timer) return;
    void this.outboxDal.ensureConsumer(this.consumerId).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.error("outbox.ensure_consumer_failed", {
        consumer_id: this.consumerId,
        error: message,
      });
    });
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("outbox.tick_failed", {
          consumer_id: this.consumerId,
          error: message,
        });
      });
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
      let rows: OutboxRow[];
      try {
        rows = await this.outboxDal.poll(this.consumerId, this.batchSize);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("outbox.poll_failed", {
          consumer_id: this.consumerId,
          error: message,
        });
        return;
      }
      if (rows.length === 0) return;

      for (const row of rows) {
        try {
          this.processRow(row);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger?.error("outbox.process_failed", {
            outbox_id: row.id,
            topic: row.topic,
            error: message,
          });
          // At-least-once semantics: don't ack cursor on failure so the row can be retried.
          return;
        }

        try {
          await this.outboxDal.ackConsumerCursor(this.consumerId, row.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger?.error("outbox.ack_failed", {
            outbox_id: row.id,
            topic: row.topic,
            error: message,
          });
          // Cursor is not advanced; retry on next tick.
          return;
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private processRow(row: OutboxRow): void {
    if (row.topic === "ws.broadcast") {
      const parsed = parseBroadcastPayload(row.payload);
      if (!parsed) return;
      if (parsed.skip_local && parsed.source_edge_id === this.consumerId) return;

      const payload = JSON.stringify(parsed.message);
      for (const client of this.connectionManager.allClients()) {
        try {
          client.ws.send(payload);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger?.warn("outbox.ws_send_failed", {
            topic: row.topic,
            connection_id: client.id,
            error: message,
          });
        }
      }
      return;
    }

    if (row.topic === "ws.direct") {
      const parsed = parseDirectPayload(row.payload);
      if (!parsed) return;
      const client = this.connectionManager.getClient(parsed.connection_id);
      if (!client) return;
      try {
        client.ws.send(JSON.stringify(parsed.message));
        if (client.role === "node") {
          const attemptId = extractAttemptId(parsed.message);
          if (attemptId) {
            const nodeId = client.device_id ?? client.id;
            this.connectionManager.recordDispatchedAttemptExecutor(attemptId, nodeId);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.warn("outbox.ws_send_failed", {
          topic: row.topic,
          connection_id: client.id,
          error: message,
        });
      }
      return;
    }
  }
}
