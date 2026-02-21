import type { SqlDb } from "../../statestore/types.js";

export interface SessionProviderPinRow {
  agent_id: string;
  session_id: string;
  provider: string;
  profile_id: string;
  pinned_at: string;
  updated_at: string;
}

interface RawSessionProviderPinRow {
  agent_id: string;
  session_id: string;
  provider: string;
  profile_id: string;
  pinned_at: string | Date;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toRow(raw: RawSessionProviderPinRow): SessionProviderPinRow {
  return {
    agent_id: raw.agent_id,
    session_id: raw.session_id,
    provider: raw.provider,
    profile_id: raw.profile_id,
    pinned_at: normalizeTime(raw.pinned_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

export class SessionProviderPinDal {
  constructor(private readonly db: SqlDb) {}

  async get(input: { agentId: string; sessionId: string; provider: string }): Promise<SessionProviderPinRow | undefined> {
    const row = await this.db.get<RawSessionProviderPinRow>(
      `SELECT *
       FROM session_provider_pins
       WHERE agent_id = ? AND session_id = ? AND provider = ?`,
      [input.agentId, input.sessionId, input.provider],
    );
    return row ? toRow(row) : undefined;
  }

  async list(input?: { agentId?: string; sessionId?: string; provider?: string; limit?: number }): Promise<SessionProviderPinRow[]> {
    const where: string[] = [];
    const values: unknown[] = [];

    if (input?.agentId) {
      where.push("agent_id = ?");
      values.push(input.agentId);
    }
    if (input?.sessionId) {
      where.push("session_id = ?");
      values.push(input.sessionId);
    }
    if (input?.provider) {
      where.push("provider = ?");
      values.push(input.provider);
    }

    const limit = Math.max(1, Math.min(500, input?.limit ?? 200));
    const sql =
      `SELECT * FROM session_provider_pins` +
      (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY updated_at DESC LIMIT ${String(limit)}`;
    const rows = await this.db.all<RawSessionProviderPinRow>(sql, values);
    return rows.map(toRow);
  }

  async upsert(input: { agentId: string; sessionId: string; provider: string; profileId: string }): Promise<SessionProviderPinRow> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO session_provider_pins (agent_id, session_id, provider, profile_id, pinned_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (agent_id, session_id, provider) DO UPDATE SET
         profile_id = excluded.profile_id,
         updated_at = excluded.updated_at`,
      [input.agentId, input.sessionId, input.provider, input.profileId, nowIso, nowIso],
    );

    const row = await this.get({ agentId: input.agentId, sessionId: input.sessionId, provider: input.provider });
    if (!row) {
      throw new Error("session provider pin upsert failed");
    }
    return row;
  }

  async clear(input: { agentId: string; sessionId: string; provider: string }): Promise<boolean> {
    const res = await this.db.run(
      `DELETE FROM session_provider_pins
       WHERE agent_id = ? AND session_id = ? AND provider = ?`,
      [input.agentId, input.sessionId, input.provider],
    );
    return res.changes === 1;
  }
}

