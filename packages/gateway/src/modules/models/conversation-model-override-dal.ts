import type { SqlDb } from "../../statestore/types.js";

export interface ConversationModelOverrideRow {
  tenant_id: string;
  conversation_id: string;
  model_id: string;
  preset_key: string | null;
  pinned_at: string;
  updated_at: string;
}

interface RawConversationModelOverrideRow {
  tenant_id: string;
  conversation_id: string;
  model_id: string;
  preset_key: string | null;
  pinned_at: string | Date;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toRow(raw: RawConversationModelOverrideRow): ConversationModelOverrideRow {
  return {
    tenant_id: raw.tenant_id,
    conversation_id: raw.conversation_id,
    model_id: raw.model_id,
    preset_key: raw.preset_key,
    pinned_at: normalizeTime(raw.pinned_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

export class ConversationModelOverrideDal {
  constructor(private readonly db: SqlDb) {}

  async get(input: {
    tenantId: string;
    conversationId: string;
  }): Promise<ConversationModelOverrideRow | undefined> {
    const row = await this.db.get<RawConversationModelOverrideRow>(
      `SELECT tenant_id,
              conversation_id AS conversation_id,
              model_id,
              preset_key,
              pinned_at,
              updated_at
       FROM conversation_model_overrides
       WHERE tenant_id = ? AND conversation_id = ?`,
      [input.tenantId, input.conversationId],
    );
    return row ? toRow(row) : undefined;
  }

  async upsert(input: {
    tenantId: string;
    conversationId: string;
    modelId: string;
    presetKey?: string | null;
  }): Promise<ConversationModelOverrideRow> {
    const nowIso = new Date().toISOString();

    await this.db.run(
      `INSERT INTO conversation_model_overrides (
         tenant_id,
         conversation_id,
         model_id,
         preset_key,
         pinned_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, conversation_id) DO UPDATE SET
         model_id = excluded.model_id,
         preset_key = excluded.preset_key,
         pinned_at = excluded.pinned_at,
         updated_at = excluded.updated_at`,
      [input.tenantId, input.conversationId, input.modelId, input.presetKey ?? null, nowIso, nowIso],
    );

    const row = await this.get({ tenantId: input.tenantId, conversationId: input.conversationId });
    if (!row) {
      throw new Error("conversation model override upsert failed");
    }
    return row;
  }

  async clear(input: { tenantId: string; conversationId: string }): Promise<boolean> {
    const res = await this.db.run(
      `DELETE FROM conversation_model_overrides
       WHERE tenant_id = ? AND conversation_id = ?`,
      [input.tenantId, input.conversationId],
    );
    return res.changes === 1;
  }
}
