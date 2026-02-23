import type { SqlDb } from "../../statestore/types.js";

export type OauthPendingMode = "auth_code" | "device_code";

export interface OauthPendingRow {
  state: string;
  provider_id: string;
  agent_id: string;
  created_at: string;
  expires_at: string;
  pkce_verifier: string;
  redirect_uri: string;
  scopes: string;
  mode: OauthPendingMode;
  metadata: Record<string, unknown>;
}

interface RawOauthPendingRow {
  state: string;
  provider_id: string;
  agent_id: string;
  created_at: string | Date;
  expires_at: string | Date;
  pkce_verifier: string;
  redirect_uri: string;
  scopes: string;
  mode: string;
  metadata_json: unknown;
}

function normalizeTime(value: string | Date | null | undefined): string {
  if (value == null) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : value;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function toRow(raw: RawOauthPendingRow): OauthPendingRow {
  const mode: OauthPendingMode = raw.mode === "device_code" ? "device_code" : "auth_code";
  return {
    state: raw.state,
    provider_id: raw.provider_id,
    agent_id: raw.agent_id,
    created_at: normalizeTime(raw.created_at),
    expires_at: normalizeTime(raw.expires_at),
    pkce_verifier: raw.pkce_verifier,
    redirect_uri: raw.redirect_uri,
    scopes: raw.scopes,
    mode,
    metadata: parseJson(raw.metadata_json),
  };
}

export class OauthPendingDal {
  constructor(private readonly db: SqlDb) {}

  async get(state: string): Promise<OauthPendingRow | undefined> {
    const row = await this.db.get<RawOauthPendingRow>(
      "SELECT * FROM oauth_pending WHERE state = ?",
      [state],
    );
    return row ? toRow(row) : undefined;
  }

  /**
   * Atomically "consume" a pending OAuth request so duplicate callbacks can't
   * process the same state concurrently.
   */
  async consume(state: string): Promise<OauthPendingRow | undefined> {
    return await this.db.transaction(async (tx) => {
      const row = await tx.get<RawOauthPendingRow>(
        "SELECT * FROM oauth_pending WHERE state = ?",
        [state],
      );
      if (!row) return undefined;

      const res = await tx.run("DELETE FROM oauth_pending WHERE state = ?", [state]);
      if (res.changes !== 1) return undefined;
      return toRow(row);
    });
  }

  async create(input: OauthPendingRow): Promise<void> {
    await this.db.run(
      `INSERT INTO oauth_pending (
         state,
         provider_id,
         agent_id,
         created_at,
         expires_at,
         pkce_verifier,
         redirect_uri,
         scopes,
         mode,
         metadata_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.state,
        input.provider_id,
        input.agent_id,
        input.created_at,
        input.expires_at,
        input.pkce_verifier,
        input.redirect_uri,
        input.scopes,
        input.mode,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async delete(state: string): Promise<void> {
    await this.db.run("DELETE FROM oauth_pending WHERE state = ?", [state]);
  }

  async deleteExpired(nowIso: string): Promise<number> {
    const res = await this.db.run("DELETE FROM oauth_pending WHERE expires_at <= ?", [nowIso]);
    return res.changes;
  }
}
