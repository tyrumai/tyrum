import type { SqlDb } from "../../statestore/types.js";

export interface SessionProviderPinRow {
  tenant_id: string;
  session_id: string;
  provider_key: string;
  auth_profile_id: string;
  auth_profile_key: string;
  pinned_at: string;
}

interface RawSessionProviderPinRow {
  tenant_id: string;
  session_id: string;
  provider_key: string;
  auth_profile_id: string;
  auth_profile_key: string;
  pinned_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toRow(raw: RawSessionProviderPinRow): SessionProviderPinRow {
  return {
    tenant_id: raw.tenant_id,
    session_id: raw.session_id,
    provider_key: raw.provider_key,
    auth_profile_id: raw.auth_profile_id,
    auth_profile_key: raw.auth_profile_key,
    pinned_at: normalizeTime(raw.pinned_at),
  };
}

export class SessionProviderPinDal {
  constructor(private readonly db: SqlDb) {}

  async get(input: {
    tenantId: string;
    sessionId: string;
    providerKey: string;
  }): Promise<SessionProviderPinRow | undefined> {
    const row = await this.db.get<RawSessionProviderPinRow>(
      `SELECT spp.tenant_id,
              spp.session_id,
              spp.provider_key,
              spp.auth_profile_id,
              ap.auth_profile_key,
              spp.pinned_at
       FROM session_provider_pins spp
       JOIN auth_profiles ap
         ON ap.tenant_id = spp.tenant_id
        AND ap.auth_profile_id = spp.auth_profile_id
       WHERE spp.tenant_id = ?
         AND spp.session_id = ?
         AND spp.provider_key = ?
       LIMIT 1`,
      [input.tenantId, input.sessionId, input.providerKey],
    );
    return row ? toRow(row) : undefined;
  }

  async list(input: {
    tenantId: string;
    sessionId?: string;
    providerKey?: string;
    limit?: number;
  }): Promise<SessionProviderPinRow[]> {
    const where: string[] = ["spp.tenant_id = ?"];
    const values: unknown[] = [input.tenantId];

    if (input.sessionId) {
      where.push("spp.session_id = ?");
      values.push(input.sessionId);
    }
    if (input.providerKey) {
      where.push("spp.provider_key = ?");
      values.push(input.providerKey);
    }

    const limit = Math.max(1, Math.min(500, input.limit ?? 200));
    const sql = `SELECT spp.tenant_id,
              spp.session_id,
              spp.provider_key,
              spp.auth_profile_id,
              ap.auth_profile_key,
              spp.pinned_at
       FROM session_provider_pins spp
       JOIN auth_profiles ap
         ON ap.tenant_id = spp.tenant_id
        AND ap.auth_profile_id = spp.auth_profile_id
       WHERE ${where.join(" AND ")}
       ORDER BY spp.pinned_at DESC
       LIMIT ${String(limit)}`;

    const rows = await this.db.all<RawSessionProviderPinRow>(sql, values);
    return rows.map(toRow);
  }

  async upsert(input: {
    tenantId: string;
    sessionId: string;
    providerKey: string;
    authProfileId: string;
  }): Promise<SessionProviderPinRow> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO session_provider_pins (
         tenant_id,
         session_id,
         provider_key,
         auth_profile_id,
         pinned_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, session_id, provider_key) DO UPDATE SET
         auth_profile_id = excluded.auth_profile_id,
         pinned_at = excluded.pinned_at`,
      [input.tenantId, input.sessionId, input.providerKey, input.authProfileId, nowIso],
    );

    const row = await this.get({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      providerKey: input.providerKey,
    });
    if (!row) {
      throw new Error("session provider pin upsert failed");
    }
    return row;
  }

  async clear(input: {
    tenantId: string;
    sessionId: string;
    providerKey: string;
  }): Promise<boolean> {
    const res = await this.db.run(
      `DELETE FROM session_provider_pins
       WHERE tenant_id = ? AND session_id = ? AND provider_key = ?`,
      [input.tenantId, input.sessionId, input.providerKey],
    );
    return res.changes === 1;
  }
}
