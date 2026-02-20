import type Database from "better-sqlite3";
import type { RedactionEngine } from "../redaction/engine.js";

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
  created_at: string;
}

function toOutboxRow(raw: RawOutboxRow): OutboxRow {
  let payload: unknown = {};
  try {
    payload = JSON.parse(raw.payload_json) as unknown;
  } catch {
    // leave as empty object
  }
  return {
    id: raw.id,
    topic: raw.topic,
    target_edge_id: raw.target_edge_id,
    payload,
    created_at: raw.created_at,
  };
}

export class OutboxDal {
  constructor(
    private readonly db: Database.Database,
    private readonly redactionEngine?: RedactionEngine,
  ) {}

  enqueue(topic: string, payload: unknown, opts?: { targetEdgeId?: string | null }): OutboxRow {
    const redactedPayload = this.redactionEngine
      ? this.redactionEngine.redactUnknown(payload ?? {}).redacted
      : (payload ?? {});
    const payloadJson = JSON.stringify(redactedPayload);
    const result = this.db
      .prepare(
        `INSERT INTO outbox (topic, target_edge_id, payload_json)
         VALUES (?, ?, ?)`,
      )
      .run(topic, opts?.targetEdgeId ?? null, payloadJson);

    const row = this.db
      .prepare("SELECT * FROM outbox WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as RawOutboxRow;

    return toOutboxRow(row);
  }

  ensureConsumer(consumerId: string): void {
    this.db
      .prepare(
        `INSERT INTO outbox_consumers (consumer_id, last_outbox_id)
         VALUES (?, 0)
         ON CONFLICT(consumer_id) DO NOTHING`,
      )
      .run(consumerId);
  }

  getConsumerCursor(consumerId: string): number {
    this.ensureConsumer(consumerId);
    const row = this.db
      .prepare("SELECT last_outbox_id FROM outbox_consumers WHERE consumer_id = ?")
      .get(consumerId) as { last_outbox_id: number } | undefined;
    return row?.last_outbox_id ?? 0;
  }

  ackConsumerCursor(consumerId: string, lastOutboxId: number): void {
    this.ensureConsumer(consumerId);
    this.db
      .prepare(
        `UPDATE outbox_consumers
         SET last_outbox_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE consumer_id = ?`,
      )
      .run(lastOutboxId, consumerId);
  }

  poll(consumerId: string, batchSize = 100): OutboxRow[] {
    const cursor = this.getConsumerCursor(consumerId);
    const rows = this.db
      .prepare(
        `SELECT *
         FROM outbox
         WHERE id > ?
           AND (target_edge_id IS NULL OR target_edge_id = ?)
         ORDER BY id ASC
         LIMIT ?`,
      )
      .all(cursor, consumerId, batchSize) as RawOutboxRow[];

    return rows.map(toOutboxRow);
  }
}

