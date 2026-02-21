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

function parseBroadcastPayload(
  payload: unknown,
): {
  message: WsEnvelope;
  source_edge_id?: string;
  skip_local?: boolean;
  target_role?: "client" | "node";
} | undefined {
  if (!isObject(payload)) return undefined;

  const maybeMessage = payload["message"];
  if (isObject(maybeMessage)) {
    const sourceEdgeId = payload["source_edge_id"];
    const skipLocal = payload["skip_local"];
    const targetRoleRaw = payload["target_role"];
    return {
      message: maybeMessage as WsEnvelope,
      source_edge_id: typeof sourceEdgeId === "string" ? sourceEdgeId : undefined,
      skip_local: typeof skipLocal === "boolean" ? skipLocal : undefined,
      target_role:
        targetRoleRaw === "client" || targetRoleRaw === "node"
          ? targetRoleRaw
          : undefined,
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
      let rows: OutboxRow[];
      try {
        rows = await this.outboxDal.poll(this.consumerId, this.batchSize);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("outbox.poll_failed", { error: message });
        return;
      }
      if (rows.length === 0) return;

      for (const row of rows) {
        let shouldAck = false;
        try {
          shouldAck = this.processRow(row);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger?.error("outbox.delivery_failed", {
            outbox_id: row.id,
            topic: row.topic,
            error: message,
          });
          // Preserve at-least-once semantics: do not advance the cursor if delivery failed.
          break;
        }

        if (!shouldAck) {
          // Some outcomes may require retry (e.g., transient downstream failure); preserve ordering.
          break;
        }

        try {
          await this.outboxDal.ackConsumerCursor(this.consumerId, row.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger?.error("outbox.ack_failed", {
            outbox_id: row.id,
            error: message,
          });
          break;
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private processRow(row: OutboxRow): boolean {
    if (row.topic === "ws.broadcast") {
      const parsed = parseBroadcastPayload(row.payload);
      if (!parsed) {
        this.logger?.warn("outbox.invalid_payload", {
          outbox_id: row.id,
          topic: row.topic,
        });
        return true;
      }
      if (parsed.skip_local && parsed.source_edge_id === this.consumerId) return true;

      const payload = JSON.stringify(parsed.message);
      for (const client of this.connectionManager.allClients()) {
        if (parsed.target_role && client.role !== parsed.target_role) continue;
        try {
          client.ws.send(payload);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger?.debug("outbox.ws_send_failed", {
            outbox_id: row.id,
            topic: row.topic,
            connection_id: client.id,
            error: message,
          });
        }
      }
      return true;
    }

    if (row.topic === "ws.direct") {
      const parsed = parseDirectPayload(row.payload);
      if (!parsed) {
        this.logger?.warn("outbox.invalid_payload", {
          outbox_id: row.id,
          topic: row.topic,
        });
        return true;
      }
      const client = this.connectionManager.getClient(parsed.connection_id);
      if (!client) {
        this.logger?.debug("outbox.direct_target_missing", {
          outbox_id: row.id,
          topic: row.topic,
          connection_id: parsed.connection_id,
        });
        return true;
      }
      try {
        client.ws.send(JSON.stringify(parsed.message));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.debug("outbox.ws_send_failed", {
          outbox_id: row.id,
          topic: row.topic,
          connection_id: parsed.connection_id,
          error: message,
        });
      }
      return true;
    }

    this.logger?.warn("outbox.unknown_topic", { outbox_id: row.id, topic: row.topic });
    return true;
  }
}
