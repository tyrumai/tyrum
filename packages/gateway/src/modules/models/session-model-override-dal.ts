import type { SqlDb } from "../../statestore/types.js";

export interface SessionModelOverrideRow {
  tenant_id: string;
  session_id: string;
  model_id: string;
  preset_key: string | null;
  pinned_at: string;
  updated_at: string;
}

interface RawSessionModelOverrideRow {
  tenant_id: string;
  session_id: string;
  model_id: string;
  preset_key: string | null;
  pinned_at: string | Date;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toRow(raw: RawSessionModelOverrideRow): SessionModelOverrideRow {
  return {
    tenant_id: raw.tenant_id,
    session_id: raw.session_id,
    model_id: raw.model_id,
    preset_key: raw.preset_key,
    pinned_at: normalizeTime(raw.pinned_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

export class SessionModelOverrideDal {
  constructor(private readonly db: SqlDb) {}

  async get(input: {
    tenantId: string;
    sessionId: string;
  }): Promise<SessionModelOverrideRow | undefined> {
    const row = await this.db.get<RawSessionModelOverrideRow>(
      `SELECT tenant_id,
              conversation_id AS session_id,
              model_id,
              preset_key,
              pinned_at,
              updated_at
       FROM conversation_model_overrides
       WHERE tenant_id = ? AND conversation_id = ?`,
      [input.tenantId, input.sessionId],
    );
    return row ? toRow(row) : undefined;
  }

  async upsert(input: {
    tenantId: string;
    sessionId: string;
    modelId: string;
    presetKey?: string | null;
  }): Promise<SessionModelOverrideRow> {
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
      [input.tenantId, input.sessionId, input.modelId, input.presetKey ?? null, nowIso, nowIso],
    );

    const row = await this.get({ tenantId: input.tenantId, sessionId: input.sessionId });
    if (!row) {
      throw new Error("session model override upsert failed");
    }
    return row;
  }

  async clear(input: { tenantId: string; sessionId: string }): Promise<boolean> {
    const res = await this.db.run(
      `DELETE FROM conversation_model_overrides
       WHERE tenant_id = ? AND conversation_id = ?`,
      [input.tenantId, input.sessionId],
    );
    return res.changes === 1;
  }
}
