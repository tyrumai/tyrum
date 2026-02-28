import type { SqlDb } from "../../statestore/types.js";

export type AuthProfileType = "api_key" | "oauth" | "token";
export type AuthProfileStatus = "active" | "disabled";

export interface AuthProfileRow {
  profile_id: string;
  agent_id: string;
  provider: string;
  type: AuthProfileType;
  secret_handles: Record<string, string>;
  labels: Record<string, unknown>;
  status: AuthProfileStatus;
  disabled_reason: string | null;
  disabled_at: string | null;
  cooldown_until_ms: number | null;
  expires_at: string | null;
  created_by: unknown | null;
  updated_by: unknown | null;
  created_at: string;
  updated_at: string;
}

interface RawAuthProfileRow {
  profile_id: string;
  agent_id: string;
  provider: string;
  type: string;
  secret_handles_json: unknown;
  labels_json: unknown;
  status: string;
  disabled_reason: string | null;
  disabled_at: string | Date | null;
  cooldown_until_ms: number | null;
  expires_at: string | Date | null;
  created_by_json: unknown;
  updated_by_json: unknown;
  created_at: string | Date;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function parseJson(
  value: unknown,
  fallback: Record<string, unknown> | Record<string, string>,
): any {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      // Intentional: treat invalid JSON columns as the provided fallback.
      return fallback;
    }
  }
  if (typeof value === "object") {
    return value;
  }
  return fallback;
}

function toRow(raw: RawAuthProfileRow): AuthProfileRow {
  const type: AuthProfileType = raw.type === "oauth" || raw.type === "token" ? raw.type : "api_key";
  const status: AuthProfileStatus = raw.status === "disabled" ? "disabled" : "active";

  const secretHandles = parseJson(raw.secret_handles_json, {}) as Record<string, string>;
  const labels = parseJson(raw.labels_json, {}) as Record<string, unknown>;
  const createdBy =
    raw.created_by_json === null ? null : (parseJson(raw.created_by_json, {}) as unknown);
  const updatedBy =
    raw.updated_by_json === null ? null : (parseJson(raw.updated_by_json, {}) as unknown);

  return {
    profile_id: raw.profile_id,
    agent_id: raw.agent_id,
    provider: raw.provider,
    type,
    secret_handles: secretHandles,
    labels,
    status,
    disabled_reason: raw.disabled_reason ?? null,
    disabled_at: normalizeTime(raw.disabled_at),
    cooldown_until_ms: typeof raw.cooldown_until_ms === "number" ? raw.cooldown_until_ms : null,
    expires_at: normalizeTime(raw.expires_at),
    created_by: createdBy,
    updated_by: updatedBy,
    created_at: normalizeTime(raw.created_at) ?? new Date().toISOString(),
    updated_at: normalizeTime(raw.updated_at) ?? new Date().toISOString(),
  };
}

export class AuthProfileDal {
  constructor(private readonly db: SqlDb) {}

  async getById(profileId: string): Promise<AuthProfileRow | undefined> {
    const row = await this.db.get<RawAuthProfileRow>(
      "SELECT * FROM auth_profiles WHERE profile_id = ?",
      [profileId],
    );
    return row ? toRow(row) : undefined;
  }

  async list(params?: {
    agentId?: string;
    provider?: string;
    status?: AuthProfileStatus;
    limit?: number;
  }): Promise<AuthProfileRow[]> {
    const where: string[] = [];
    const values: unknown[] = [];

    if (params?.agentId) {
      where.push("agent_id = ?");
      values.push(params.agentId);
    }
    if (params?.provider) {
      where.push("provider = ?");
      values.push(params.provider);
    }
    if (params?.status) {
      where.push("status = ?");
      values.push(params.status);
    }

    const limit = Math.max(1, Math.min(500, params?.limit ?? 200));
    const sql =
      `SELECT * FROM auth_profiles` +
      (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY created_at ASC, profile_id ASC LIMIT ${String(limit)}`;

    const rows = await this.db.all<RawAuthProfileRow>(sql, values);
    return rows.map(toRow);
  }

  async listByAgentAfter(params: {
    agentId: string;
    after?: { createdAt: string; profileId: string };
    limit?: number;
  }): Promise<AuthProfileRow[]> {
    const limit = Math.max(1, Math.min(500, params.limit ?? 200));
    const where: string[] = ["agent_id = ?"];
    const values: unknown[] = [params.agentId];

    if (params.after) {
      where.push("(created_at > ? OR (created_at = ? AND profile_id > ?))");
      values.push(params.after.createdAt, params.after.createdAt, params.after.profileId);
    }

    const sql =
      `SELECT * FROM auth_profiles` +
      ` WHERE ${where.join(" AND ")}` +
      ` ORDER BY created_at ASC, profile_id ASC LIMIT ${String(limit)}`;

    const rows = await this.db.all<RawAuthProfileRow>(sql, values);
    return rows.map(toRow);
  }

  async listEligibleForProvider(params: {
    agentId: string;
    provider: string;
    nowMs: number;
  }): Promise<AuthProfileRow[]> {
    const rows = await this.db.all<RawAuthProfileRow>(
      `SELECT *
       FROM auth_profiles
       WHERE agent_id = ?
         AND provider = ?
         AND status = 'active'
         AND (cooldown_until_ms IS NULL OR cooldown_until_ms <= ?)
       ORDER BY created_at ASC, profile_id ASC`,
      [params.agentId, params.provider, params.nowMs],
    );

    const nowIso = new Date(params.nowMs).toISOString();
    return rows.map(toRow).filter((r) => {
      if (r.expires_at == null || r.expires_at > nowIso) return true;
      if (r.type !== "oauth") return false;

      // Allow expired OAuth profiles through if they can be refreshed.
      const refreshHandleId = r.secret_handles?.["refresh_token_handle"];
      return typeof refreshHandleId === "string" && refreshHandleId.trim().length > 0;
    });
  }

  async create(input: {
    profileId: string;
    agentId: string;
    provider: string;
    type: AuthProfileType;
    secretHandles: Record<string, string>;
    labels?: Record<string, unknown>;
    expiresAt?: string | null;
    createdBy?: unknown;
  }): Promise<AuthProfileRow> {
    const nowIso = new Date().toISOString();

    await this.db.run(
      `INSERT INTO auth_profiles (
         profile_id,
         agent_id,
         provider,
         type,
         secret_handles_json,
         labels_json,
         status,
         expires_at,
         created_by_json,
         updated_by_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      [
        input.profileId,
        input.agentId,
        input.provider,
        input.type,
        JSON.stringify(input.secretHandles ?? {}),
        JSON.stringify(input.labels ?? {}),
        input.expiresAt ?? null,
        input.createdBy ? JSON.stringify(input.createdBy) : null,
        input.createdBy ? JSON.stringify(input.createdBy) : null,
        nowIso,
        nowIso,
      ],
    );

    const row = await this.getById(input.profileId);
    if (!row) {
      throw new Error("auth profile insert failed");
    }
    return row;
  }

  async updateProfile(
    profileId: string,
    input: { labels?: Record<string, unknown>; expiresAt?: string | null; updatedBy?: unknown },
  ): Promise<AuthProfileRow | undefined> {
    const nowIso = new Date().toISOString();
    const row = await this.getById(profileId);
    if (!row) return undefined;

    const nextLabels = input.labels ?? row.labels;
    const nextExpiresAt = typeof input.expiresAt === "undefined" ? row.expires_at : input.expiresAt;
    const updatedByJson = input.updatedBy ? JSON.stringify(input.updatedBy) : null;

    await this.db.run(
      `UPDATE auth_profiles
       SET labels_json = ?,
           expires_at = ?,
           updated_by_json = COALESCE(?, updated_by_json),
           updated_at = ?
       WHERE profile_id = ?`,
      [JSON.stringify(nextLabels ?? {}), nextExpiresAt ?? null, updatedByJson, nowIso, profileId],
    );

    return await this.getById(profileId);
  }

  async updateSecretHandles(
    profileId: string,
    input: {
      secretHandles: Record<string, string>;
      expiresAt?: string | null;
      updatedBy?: unknown;
    },
  ): Promise<AuthProfileRow | undefined> {
    const nowIso = new Date().toISOString();
    const row = await this.getById(profileId);
    if (!row) return undefined;

    const nextExpiresAt = typeof input.expiresAt === "undefined" ? row.expires_at : input.expiresAt;
    const updatedByJson = input.updatedBy ? JSON.stringify(input.updatedBy) : null;

    await this.db.run(
      `UPDATE auth_profiles
       SET secret_handles_json = ?,
           expires_at = ?,
           updated_by_json = COALESCE(?, updated_by_json),
           updated_at = ?
       WHERE profile_id = ?`,
      [
        JSON.stringify(input.secretHandles ?? {}),
        nextExpiresAt ?? null,
        updatedByJson,
        nowIso,
        profileId,
      ],
    );

    return await this.getById(profileId);
  }

  async disableProfile(
    profileId: string,
    input?: { reason?: string; updatedBy?: unknown },
  ): Promise<AuthProfileRow | undefined> {
    const nowIso = new Date().toISOString();
    const updatedByJson = input?.updatedBy ? JSON.stringify(input.updatedBy) : null;
    const res = await this.db.run(
      `UPDATE auth_profiles
       SET status = 'disabled',
           disabled_reason = ?,
           disabled_at = ?,
           cooldown_until_ms = NULL,
           updated_by_json = COALESCE(?, updated_by_json),
           updated_at = ?
       WHERE profile_id = ?`,
      [input?.reason ?? null, nowIso, updatedByJson, nowIso, profileId],
    );
    if (res.changes !== 1) return undefined;
    return await this.getById(profileId);
  }

  async enableProfile(
    profileId: string,
    input?: { updatedBy?: unknown },
  ): Promise<AuthProfileRow | undefined> {
    const nowIso = new Date().toISOString();
    const updatedByJson = input?.updatedBy ? JSON.stringify(input.updatedBy) : null;
    const res = await this.db.run(
      `UPDATE auth_profiles
       SET status = 'active',
           disabled_reason = NULL,
           disabled_at = NULL,
           cooldown_until_ms = NULL,
           updated_by_json = COALESCE(?, updated_by_json),
           updated_at = ?
       WHERE profile_id = ?`,
      [updatedByJson, nowIso, profileId],
    );
    if (res.changes !== 1) return undefined;
    return await this.getById(profileId);
  }

  async setCooldown(
    profileId: string,
    input: { untilMs: number; updatedBy?: unknown },
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    const updatedByJson = input.updatedBy ? JSON.stringify(input.updatedBy) : null;
    await this.db.run(
      `UPDATE auth_profiles
       SET cooldown_until_ms = ?,
           updated_by_json = COALESCE(?, updated_by_json),
           updated_at = ?
       WHERE profile_id = ? AND status = 'active'`,
      [Math.max(0, Math.floor(input.untilMs)), updatedByJson, nowIso, profileId],
    );
  }
}
