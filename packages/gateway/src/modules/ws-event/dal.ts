import type { WsEventEnvelope } from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import type { WsBroadcastAudience } from "../../ws/audience.js";
import type { SqlDb } from "../../statestore/types.js";

interface RawWsEventRow {
  tenant_id: string;
  event_key: string;
  event_id: string;
  type: string;
  occurred_at: string | Date;
  payload_json: string;
  audience_json: string | null;
}

export interface PersistedWsEvent {
  event: WsEventEnvelope;
  audience?: WsBroadcastAudience;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseJson<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Intentional: treat invalid JSON columns as absent and preserve the event envelope.
    return undefined;
  }
}

function toPersistedWsEvent(row: RawWsEventRow): PersistedWsEvent {
  return {
    event: {
      event_id: row.event_id,
      type: row.type as WsEventEnvelope["type"],
      occurred_at: normalizeTime(row.occurred_at),
      payload: parseJson<unknown>(row.payload_json) ?? {},
    },
    audience: parseJson<WsBroadcastAudience>(row.audience_json),
  };
}

export class WsEventDal {
  constructor(private readonly db: SqlDb) {}

  async ensureEvent(input: {
    tenantId: string;
    eventKey: string;
    type: WsEventEnvelope["type"];
    occurredAt: string;
    payload: unknown;
    audience?: WsBroadcastAudience;
  }): Promise<PersistedWsEvent> {
    const tenantId = input.tenantId.trim();
    const eventKey = input.eventKey.trim();
    if (tenantId.length === 0) {
      throw new Error("tenantId is required");
    }
    if (eventKey.length === 0) {
      throw new Error("eventKey is required");
    }

    return await this.db.transaction(async (tx) => {
      const inserted = await tx.get<RawWsEventRow>(
        `INSERT INTO ws_events (
           tenant_id,
           event_key,
           event_id,
           type,
           occurred_at,
           payload_json,
           audience_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, event_key) DO NOTHING
         RETURNING *`,
        [
          tenantId,
          eventKey,
          randomUUID(),
          input.type,
          input.occurredAt,
          JSON.stringify(input.payload ?? {}),
          input.audience ? JSON.stringify(input.audience) : null,
        ],
      );
      if (inserted) {
        return toPersistedWsEvent(inserted);
      }

      const existing = await tx.get<RawWsEventRow>(
        `SELECT tenant_id, event_key, event_id, type, occurred_at, payload_json, audience_json
         FROM ws_events
         WHERE tenant_id = ? AND event_key = ?`,
        [tenantId, eventKey],
      );
      if (!existing) {
        throw new Error("failed to persist ws event");
      }
      return toPersistedWsEvent(existing);
    });
  }
}
