import type { SqlDb } from "../../statestore/types.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";

export type ConversationQueueModeOverrideRow = {
  key: string;
  queue_mode: string;
  updated_at_ms: number;
};

type RawConversationQueueModeOverrideRow = {
  key: string;
  queue_mode: string;
  updated_at_ms: number | string;
};

function asNumber(value: number | string): number {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class ConversationQueueModeOverrideDal {
  constructor(private readonly db: SqlDb) {}

  async get(input: {
    tenant_id?: string;
    key: string;
  }): Promise<ConversationQueueModeOverrideRow | undefined> {
    const tenantId = input.tenant_id?.trim() || DEFAULT_TENANT_ID;
    const row = await this.db.get<RawConversationQueueModeOverrideRow>(
      `SELECT conversation_key AS key, queue_mode, updated_at_ms
       FROM conversation_queue_overrides
       WHERE tenant_id = ? AND conversation_key = ?`,
      [tenantId, input.key],
    );
    if (!row) return undefined;
    return {
      key: row.key,
      queue_mode: row.queue_mode,
      updated_at_ms: asNumber(row.updated_at_ms),
    };
  }

  async upsert(input: {
    tenant_id?: string;
    key: string;
    queueMode: string;
  }): Promise<ConversationQueueModeOverrideRow> {
    const tenantId = input.tenant_id?.trim() || DEFAULT_TENANT_ID;
    const nowMs = Date.now();
    await this.db.run(
      `INSERT INTO conversation_queue_overrides (
         tenant_id,
         conversation_key,
         queue_mode,
         updated_at_ms
       )
       VALUES (?, ?, ?, ?)
       ON CONFLICT (tenant_id, conversation_key) DO UPDATE SET
         queue_mode = excluded.queue_mode,
         updated_at_ms = excluded.updated_at_ms`,
      [tenantId, input.key, input.queueMode, nowMs],
    );

    const row = await this.get({ tenant_id: tenantId, key: input.key });
    if (!row) {
      throw new Error("conversation queue mode override upsert failed");
    }
    return row;
  }

  async createIfAbsent(input: {
    tenant_id?: string;
    key: string;
    queueMode: string;
  }): Promise<{ row: ConversationQueueModeOverrideRow; created: boolean }> {
    const tenantId = input.tenant_id?.trim() || DEFAULT_TENANT_ID;
    const nowMs = Date.now();
    const result = await this.db.run(
      `INSERT INTO conversation_queue_overrides (
         tenant_id,
         conversation_key,
         queue_mode,
         updated_at_ms
       )
       VALUES (?, ?, ?, ?)
       ON CONFLICT (tenant_id, conversation_key) DO NOTHING`,
      [tenantId, input.key, input.queueMode, nowMs],
    );

    const row = await this.get({ tenant_id: tenantId, key: input.key });
    if (!row) {
      throw new Error("conversation queue mode override createIfAbsent failed");
    }

    return { row, created: result.changes === 1 };
  }

  async clear(input: { tenant_id?: string; key: string }): Promise<boolean> {
    const tenantId = input.tenant_id?.trim() || DEFAULT_TENANT_ID;
    const res = await this.db.run(
      "DELETE FROM conversation_queue_overrides WHERE tenant_id = ? AND conversation_key = ?",
      [tenantId, input.key],
    );
    return res.changes === 1;
  }
}
