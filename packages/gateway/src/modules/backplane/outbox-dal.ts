import type { RedactionEngine } from "../redaction/engine.js";
import type { SqlDb } from "../../statestore/types.js";

export interface OutboxRow {
  id: number;
  tenant_id: string;
  topic: string;
  target_edge_id: string | null;
  payload: unknown;
  created_at: string;
}

interface RawOutboxRow {
  id: number;
  tenant_id: string;
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
    tenant_id: raw.tenant_id,
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

  async listActiveTenantIds(): Promise<string[]> {
    const rows = await this.db.all<{ tenant_id: string }>(
      "SELECT tenant_id FROM tenants WHERE status = 'active' ORDER BY tenant_id ASC",
    );
    return rows.map((row) => row.tenant_id).filter((id) => id.trim().length > 0);
  }

  async enqueue(
    tenantId: string,
    topic: string,
    payload: unknown,
    opts?: { targetEdgeId?: string | null },
  ): Promise<OutboxRow> {
    const normalizedTenantId = tenantId.trim();
    if (normalizedTenantId.length === 0) {
      throw new Error("tenantId is required");
    }

    const redactedPayload = this.redactionEngine
      ? this.redactionEngine.redactUnknown(payload ?? {}).redacted
      : (payload ?? {});
    const payloadJson = JSON.stringify(redactedPayload);

    const row = await this.db.get<RawOutboxRow>(
      `INSERT INTO outbox (tenant_id, topic, target_edge_id, payload_json)
       VALUES (?, ?, ?, ?)
       RETURNING *`,
      [normalizedTenantId, topic, opts?.targetEdgeId ?? null, payloadJson],
    );
    if (!row) {
      throw new Error("outbox insert failed");
    }

    return toOutboxRow(row);
  }

  async ensureConsumer(tenantId: string, consumerId: string): Promise<void> {
    const normalizedTenantId = tenantId.trim();
    if (normalizedTenantId.length === 0) {
      throw new Error("tenantId is required");
    }
    await this.db.run(
      `INSERT INTO outbox_consumers (tenant_id, consumer_id, last_outbox_id)
       VALUES (?, ?, 0)
       ON CONFLICT(tenant_id, consumer_id) DO NOTHING`,
      [normalizedTenantId, consumerId],
    );
  }

  async getConsumerCursor(tenantId: string, consumerId: string): Promise<number> {
    const normalizedTenantId = tenantId.trim();
    if (normalizedTenantId.length === 0) {
      throw new Error("tenantId is required");
    }
    await this.ensureConsumer(normalizedTenantId, consumerId);
    const row = await this.db.get<{ last_outbox_id: number }>(
      "SELECT last_outbox_id FROM outbox_consumers WHERE tenant_id = ? AND consumer_id = ?",
      [normalizedTenantId, consumerId],
    );
    return row?.last_outbox_id ?? 0;
  }

  async ackConsumerCursor(
    tenantId: string,
    consumerId: string,
    lastOutboxId: number,
  ): Promise<void> {
    const normalizedTenantId = tenantId.trim();
    if (normalizedTenantId.length === 0) {
      throw new Error("tenantId is required");
    }
    await this.ensureConsumer(normalizedTenantId, consumerId);
    await this.db.run(
      `UPDATE outbox_consumers
       SET last_outbox_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = ? AND consumer_id = ?`,
      [lastOutboxId, normalizedTenantId, consumerId],
    );
  }

  async poll(tenantId: string, consumerId: string, batchSize = 100): Promise<OutboxRow[]> {
    const normalizedTenantId = tenantId.trim();
    if (normalizedTenantId.length === 0) {
      throw new Error("tenantId is required");
    }
    const cursor = await this.getConsumerCursor(normalizedTenantId, consumerId);
    const rows = await this.db.all<RawOutboxRow>(
      `SELECT *
       FROM outbox
       WHERE tenant_id = ?
         AND id > ?
         AND (target_edge_id IS NULL OR target_edge_id = ?)
       ORDER BY id ASC
       LIMIT ?`,
      [normalizedTenantId, cursor, consumerId, batchSize],
    );
    return rows.map(toOutboxRow);
  }
}
