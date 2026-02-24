import type { SqlDb } from "../../statestore/types.js";

export interface SessionModelOverrideRow {
  agent_id: string;
  session_id: string;
  model_id: string;
  pinned_at: string;
  updated_at: string;
}

interface RawSessionModelOverrideRow {
  agent_id: string;
  session_id: string;
  model_id: string;
  pinned_at: string | Date;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toRow(raw: RawSessionModelOverrideRow): SessionModelOverrideRow {
  return {
    agent_id: raw.agent_id,
    session_id: raw.session_id,
    model_id: raw.model_id,
    pinned_at: normalizeTime(raw.pinned_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

export class SessionModelOverrideDal {
  constructor(private readonly db: SqlDb) {}

  async get(input: { agentId: string; sessionId: string }): Promise<SessionModelOverrideRow | undefined> {
    const row = await this.db.get<RawSessionModelOverrideRow>(
      `SELECT *
       FROM session_model_overrides
       WHERE agent_id = ? AND session_id = ?`,
      [input.agentId, input.sessionId],
    );
    return row ? toRow(row) : undefined;
  }

  async upsert(input: { agentId: string; sessionId: string; modelId: string }): Promise<SessionModelOverrideRow> {
    const nowIso = new Date().toISOString();

    await this.db.run(
      `INSERT INTO session_model_overrides (agent_id, session_id, model_id, pinned_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (agent_id, session_id) DO UPDATE SET
         model_id = excluded.model_id,
         updated_at = excluded.updated_at`,
      [input.agentId, input.sessionId, input.modelId, nowIso, nowIso],
    );

    const row = await this.get({ agentId: input.agentId, sessionId: input.sessionId });
    if (!row) {
      throw new Error("session model override upsert failed");
    }
    return row;
  }

  async clear(input: { agentId: string; sessionId: string }): Promise<boolean> {
    const res = await this.db.run(
      `DELETE FROM session_model_overrides
       WHERE agent_id = ? AND session_id = ?`,
      [input.agentId, input.sessionId],
    );
    return res.changes === 1;
  }
}

