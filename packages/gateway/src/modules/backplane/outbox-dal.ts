import type { RedactionEngine } from "../redaction/engine.js";
import type { SqlDb } from "../../statestore/types.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";

export interface OutboxRow {
  id: number;
  topic: string;
  target_edge_id: string | null;
  payload: unknown;
  created_at: string;
}

interface RawOutboxRow {
  id: number;
  topic: string;
  target_edge_id: string | null;
  payload_json: string;
  created_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toOutboxRow(raw: RawOutboxRow): OutboxRow {
  let payload: unknown = {};
  try {
    payload = JSON.parse(raw.payload_json) as unknown;
  } catch {
    // Intentional: treat invalid JSON payloads as empty objects.
  }
  return {
    id: raw.id,
    topic: raw.topic,
    target_edge_id: raw.target_edge_id,
    payload,
    created_at: normalizeTime(raw.created_at),
  };
}

export class OutboxDal {
  constructor(
    private readonly db: SqlDb,
    private readonly redactionEngine?: RedactionEngine,
  ) {}

  async enqueue(
    topic: string,
    payload: unknown,
    opts?: { targetEdgeId?: string | null },
  ): Promise<OutboxRow> {
    const redactedPayload = this.redactionEngine
      ? this.redactionEngine.redactUnknown(payload ?? {}).redacted
      : (payload ?? {});
    const payloadJson = JSON.stringify(redactedPayload);

    const row = await this.db.get<RawOutboxRow>(
      `INSERT INTO outbox (tenant_id, topic, target_edge_id, payload_json)
       VALUES (?, ?, ?, ?)
       RETURNING *`,
      [DEFAULT_TENANT_ID, topic, opts?.targetEdgeId ?? null, payloadJson],
    );
    if (!row) {
      throw new Error("outbox insert failed");
    }

    return toOutboxRow(row);
  }

  async ensureConsumer(consumerId: string): Promise<void> {
    await this.db.run(
      `INSERT INTO outbox_consumers (tenant_id, consumer_id, last_outbox_id)
       VALUES (?, ?, 0)
       ON CONFLICT(tenant_id, consumer_id) DO NOTHING`,
      [DEFAULT_TENANT_ID, consumerId],
    );
  }

  async getConsumerCursor(consumerId: string): Promise<number> {
    await this.ensureConsumer(consumerId);
    const row = await this.db.get<{ last_outbox_id: number }>(
      "SELECT last_outbox_id FROM outbox_consumers WHERE tenant_id = ? AND consumer_id = ?",
      [DEFAULT_TENANT_ID, consumerId],
    );
    return row?.last_outbox_id ?? 0;
  }

  async ackConsumerCursor(consumerId: string, lastOutboxId: number): Promise<void> {
    await this.ensureConsumer(consumerId);
    await this.db.run(
      `UPDATE outbox_consumers
       SET last_outbox_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND consumer_id = ?`,
      [lastOutboxId, DEFAULT_TENANT_ID, consumerId],
    );
  }

  async poll(consumerId: string, batchSize = 100): Promise<OutboxRow[]> {
    const cursor = await this.getConsumerCursor(consumerId);
    const rows = await this.db.all<RawOutboxRow>(
      `SELECT *
       FROM outbox
       WHERE tenant_id = ?
         AND id > ?
         AND (target_edge_id IS NULL OR target_edge_id = ?)
       ORDER BY id ASC
       LIMIT ?`,
      [DEFAULT_TENANT_ID, cursor, consumerId, batchSize],
    );
    return rows.map(toOutboxRow);
  }
}
