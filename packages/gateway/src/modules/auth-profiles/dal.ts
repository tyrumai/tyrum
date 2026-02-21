import type { AuthProfile as AuthProfileT, AuthProfileType as AuthProfileTypeT } from "@tyrum/schemas";
import { AuthProfile } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

export interface AuthProfileRow {
  profile_id: string;
  agent_id: string;
  provider: string;
  type: AuthProfileTypeT;
  oauth_json: string | null;
  secret_handles_json: string;
  expires_at: string | Date | null;
  labels_json: string | null;
  disabled_at: string | Date | null;
  disabled_reason: string | null;
  cooldown_until: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date | null | undefined): string | undefined {
  if (value == null) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function rowToProfile(row: AuthProfileRow): AuthProfileT {
  const secretHandles = JSON.parse(row.secret_handles_json) as unknown;
  const labels = row.labels_json ? (JSON.parse(row.labels_json) as unknown) : {};
  const base: Record<string, unknown> = {
    profile_id: row.profile_id,
    agent_id: row.agent_id,
    provider: row.provider,
    type: row.type,
    secret_handles: secretHandles,
    expires_at: normalizeTime(row.expires_at),
    labels,
    disabled_at: normalizeTime(row.disabled_at),
    disabled_reason: row.disabled_reason ?? undefined,
    cooldown_until: normalizeTime(row.cooldown_until),
    created_at: normalizeTime(row.created_at) ?? new Date().toISOString(),
    updated_at: normalizeTime(row.updated_at) ?? new Date().toISOString(),
  };

  if (row.type === "oauth") {
    base["oauth"] = row.oauth_json ? (JSON.parse(row.oauth_json) as unknown) : undefined;
  }

  return AuthProfile.parse(base);
}

export class AuthProfileDal {
  constructor(private readonly db: SqlDb) {}

  async create(opts: {
    profileId: string;
    agentId: string;
    provider: string;
    type: AuthProfileTypeT;
    oauth?: unknown;
    secretHandles: unknown;
    expiresAt?: string;
    labels?: Record<string, string>;
  }): Promise<AuthProfileT> {
    const nowIso = new Date().toISOString();
    const labelsJson = JSON.stringify(opts.labels ?? {});
    const secretHandlesJson = JSON.stringify(opts.secretHandles ?? {});
    const oauthJson = opts.type === "oauth" ? JSON.stringify(opts.oauth ?? {}) : null;

    await this.db.run(
      `INSERT INTO auth_profiles (
         profile_id,
         agent_id,
         provider,
         type,
         oauth_json,
         secret_handles_json,
         expires_at,
         labels_json,
         disabled_at,
         disabled_reason,
         cooldown_until,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
      [
        opts.profileId,
        opts.agentId,
        opts.provider,
        opts.type,
        oauthJson,
        secretHandlesJson,
        opts.expiresAt ?? null,
        labelsJson,
        nowIso,
        nowIso,
      ],
    );

    const created = await this.getById(opts.profileId);
    if (!created) {
      throw new Error("auth profile insert failed");
    }
    return created;
  }

  async list(filter?: { agentId?: string; provider?: string }): Promise<AuthProfileT[]> {
    const where: string[] = [];
    const args: unknown[] = [];

    if (filter?.agentId) {
      where.push("agent_id = ?");
      args.push(filter.agentId);
    }
    if (filter?.provider) {
      where.push("provider = ?");
      args.push(filter.provider);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await this.db.all<AuthProfileRow>(
      `SELECT
         profile_id,
         agent_id,
         provider,
         type,
         oauth_json,
         secret_handles_json,
         expires_at,
         labels_json,
         disabled_at,
         disabled_reason,
         cooldown_until,
         created_at,
         updated_at
       FROM auth_profiles
       ${clause}
       ORDER BY created_at ASC, profile_id ASC`,
      args,
    );

    return rows.map(rowToProfile);
  }

  async getById(profileId: string): Promise<AuthProfileT | undefined> {
    const row = await this.db.get<AuthProfileRow>(
      `SELECT
         profile_id,
         agent_id,
         provider,
         type,
         oauth_json,
         secret_handles_json,
         expires_at,
         labels_json,
         disabled_at,
         disabled_reason,
         cooldown_until,
         created_at,
         updated_at
       FROM auth_profiles
       WHERE profile_id = ?`,
      [profileId],
    );
    if (!row) return undefined;
    return rowToProfile(row);
  }

  async delete(profileId: string): Promise<AuthProfileT | undefined> {
    const existing = await this.getById(profileId);
    if (!existing) return undefined;

    await this.db.run("DELETE FROM auth_profiles WHERE profile_id = ?", [profileId]);
    await this.db.run("DELETE FROM session_auth_pins WHERE profile_id = ?", [profileId]);
    return existing;
  }

  async getPinnedProfileId(sessionId: string, provider: string): Promise<string | undefined> {
    const row = await this.db.get<{ profile_id: string }>(
      "SELECT profile_id FROM session_auth_pins WHERE session_id = ? AND provider = ?",
      [sessionId, provider],
    );
    return row?.profile_id;
  }

  async setPinnedProfileId(sessionId: string, provider: string, profileId: string): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO session_auth_pins (
         session_id,
         provider,
         profile_id,
         pinned_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (session_id, provider) DO UPDATE SET
         profile_id = excluded.profile_id,
         updated_at = excluded.updated_at`,
      [sessionId, provider, profileId, nowIso, nowIso],
    );
  }

  async clearPinnedProfileId(sessionId: string, provider: string): Promise<void> {
    await this.db.run("DELETE FROM session_auth_pins WHERE session_id = ? AND provider = ?", [
      sessionId,
      provider,
    ]);
  }

  async updateTokens(opts: {
    profileId: string;
    secretHandles: unknown;
    expiresAt?: string;
  }): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE auth_profiles
       SET secret_handles_json = ?, expires_at = ?, updated_at = ?
       WHERE profile_id = ?`,
      [JSON.stringify(opts.secretHandles ?? {}), opts.expiresAt ?? null, nowIso, opts.profileId],
    );
  }
}

