import type { SqlDb } from "../../statestore/types.js";

export interface AuthProfileRow {
  profile_id: string;
  provider: string;
  label: string | null;
  secret_handle: string | null;
  priority: number;
  is_active: boolean;
  last_used_at: string | null;
  failure_count: number;
  created_at: string;
  metadata: unknown;
}

interface RawAuthProfileRow {
  profile_id: string;
  provider: string;
  label: string | null;
  secret_handle: string | null;
  priority: number;
  is_active: number;
  last_used_at: string | null;
  failure_count: number;
  created_at: string | Date;
  metadata: string | null;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toAuthProfileRow(raw: RawAuthProfileRow): AuthProfileRow {
  let metadata: unknown = null;
  if (raw.metadata) {
    try { metadata = JSON.parse(raw.metadata) as unknown; } catch { /* ignore */ }
  }
  return {
    profile_id: raw.profile_id,
    provider: raw.provider,
    label: raw.label,
    secret_handle: raw.secret_handle,
    priority: raw.priority,
    is_active: raw.is_active === 1,
    last_used_at: raw.last_used_at,
    failure_count: raw.failure_count,
    created_at: normalizeTime(raw.created_at),
    metadata,
  };
}

export class AuthProfileDal {
  constructor(private readonly db: SqlDb) {}

  async create(params: {
    profileId: string;
    provider: string;
    label?: string;
    secretHandle?: string;
    priority?: number;
    metadata?: unknown;
  }): Promise<AuthProfileRow> {
    const metadataJson = params.metadata ? JSON.stringify(params.metadata) : null;
    const row = await this.db.get<RawAuthProfileRow>(
      `INSERT INTO model_auth_profiles (profile_id, provider, label, secret_handle, priority, metadata)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [params.profileId, params.provider, params.label ?? null, params.secretHandle ?? null, params.priority ?? 0, metadataJson],
    );
    if (!row) throw new Error("profile insert failed");
    return toAuthProfileRow(row);
  }

  async getById(profileId: string): Promise<AuthProfileRow | undefined> {
    const row = await this.db.get<RawAuthProfileRow>(
      "SELECT * FROM model_auth_profiles WHERE profile_id = ?",
      [profileId],
    );
    return row ? toAuthProfileRow(row) : undefined;
  }

  async listByProvider(provider: string): Promise<AuthProfileRow[]> {
    const rows = await this.db.all<RawAuthProfileRow>(
      "SELECT * FROM model_auth_profiles WHERE provider = ? AND is_active = 1 ORDER BY priority ASC, failure_count ASC",
      [provider],
    );
    return rows.map(toAuthProfileRow);
  }

  async listAll(): Promise<AuthProfileRow[]> {
    const rows = await this.db.all<RawAuthProfileRow>(
      "SELECT * FROM model_auth_profiles ORDER BY provider, priority ASC",
      [],
    );
    return rows.map(toAuthProfileRow);
  }

  async recordUsage(profileId: string): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      "UPDATE model_auth_profiles SET last_used_at = ? WHERE profile_id = ?",
      [nowIso, profileId],
    );
  }

  async recordFailure(profileId: string): Promise<void> {
    await this.db.run(
      "UPDATE model_auth_profiles SET failure_count = failure_count + 1 WHERE profile_id = ?",
      [profileId],
    );
  }

  async resetFailures(profileId: string): Promise<void> {
    await this.db.run(
      "UPDATE model_auth_profiles SET failure_count = 0 WHERE profile_id = ?",
      [profileId],
    );
  }

  async deactivate(profileId: string): Promise<void> {
    await this.db.run(
      "UPDATE model_auth_profiles SET is_active = 0 WHERE profile_id = ?",
      [profileId],
    );
  }

  async activate(profileId: string): Promise<void> {
    await this.db.run(
      "UPDATE model_auth_profiles SET is_active = 1 WHERE profile_id = ?",
      [profileId],
    );
  }
}
