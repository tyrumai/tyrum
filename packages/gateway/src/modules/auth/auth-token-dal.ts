import type { SqlDb } from "../../statestore/types.js";

export type AuthTokenRole = "admin" | "client" | "node";

export interface AuthTokenRow {
  token_id: string;
  tenant_id: string | null;
  display_name: string;
  role: AuthTokenRole;
  device_id: string | null;
  scopes_json: string;
  secret_salt: string;
  secret_hash: string;
  kdf: string;
  issued_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_by_json: string;
  created_at: string;
  updated_at: string;
}

export interface AuthTokenListRow {
  token_id: string;
  tenant_id: string | null;
  display_name: string;
  role: AuthTokenRole;
  device_id: string | null;
  scopes_json: string;
  issued_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_by_json: string;
  created_at: string;
  updated_at: string;
}

interface RawAuthTokenRow {
  token_id: string;
  tenant_id: string | null;
  display_name: string;
  role: string;
  device_id: string | null;
  scopes_json: string;
  secret_salt: string;
  secret_hash: string;
  kdf: string;
  issued_at: string | Date;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
  created_by_json: string;
  created_at: string | Date;
  updated_at: string | Date;
}

interface RawAuthTokenListRow {
  token_id: string;
  tenant_id: string | null;
  display_name: string;
  role: string;
  device_id: string | null;
  scopes_json: string;
  issued_at: string | Date;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
  created_by_json: string;
  created_at: string | Date;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed) && !trimmed.includes("T")) {
    return trimmed.replace(" ", "T") + "Z";
  }
  return trimmed;
}

function normalizeRole(raw: string): AuthTokenRole {
  if (raw === "admin" || raw === "client" || raw === "node") return raw;
  return "client";
}

function toRow(raw: RawAuthTokenRow): AuthTokenRow {
  return {
    token_id: raw.token_id,
    tenant_id: raw.tenant_id,
    display_name: raw.display_name,
    role: normalizeRole(raw.role),
    device_id: raw.device_id,
    scopes_json: raw.scopes_json,
    secret_salt: raw.secret_salt,
    secret_hash: raw.secret_hash,
    kdf: raw.kdf,
    issued_at: normalizeTime(raw.issued_at) ?? new Date().toISOString(),
    expires_at: normalizeTime(raw.expires_at),
    revoked_at: normalizeTime(raw.revoked_at),
    created_by_json: raw.created_by_json,
    created_at: normalizeTime(raw.created_at) ?? new Date().toISOString(),
    updated_at: normalizeTime(raw.updated_at) ?? new Date().toISOString(),
  };
}

function toListRow(raw: RawAuthTokenListRow): AuthTokenListRow {
  return {
    token_id: raw.token_id,
    tenant_id: raw.tenant_id,
    display_name: raw.display_name,
    role: normalizeRole(raw.role),
    device_id: raw.device_id,
    scopes_json: raw.scopes_json,
    issued_at: normalizeTime(raw.issued_at) ?? new Date().toISOString(),
    expires_at: normalizeTime(raw.expires_at),
    revoked_at: normalizeTime(raw.revoked_at),
    created_by_json: raw.created_by_json,
    created_at: normalizeTime(raw.created_at) ?? new Date().toISOString(),
    updated_at: normalizeTime(raw.updated_at) ?? new Date().toISOString(),
  };
}

export class AuthTokenDal {
  constructor(private readonly db: SqlDb) {}

  async listForTenant(tenantId: string): Promise<AuthTokenListRow[]> {
    const rows = await this.db.all<RawAuthTokenListRow>(
      `SELECT
         token_id,
         tenant_id,
         display_name,
         role,
         device_id,
         scopes_json,
         issued_at,
         expires_at,
         revoked_at,
         created_by_json,
         created_at,
         updated_at
       FROM auth_tokens
       WHERE tenant_id = ?
       ORDER BY
         CASE WHEN revoked_at IS NULL THEN 0 ELSE 1 END ASC,
         updated_at DESC,
         issued_at DESC,
         created_at DESC`,
      [tenantId],
    );
    return rows.map(toListRow);
  }

  async getById(tokenId: string): Promise<AuthTokenRow | undefined> {
    const row = await this.db.get<RawAuthTokenRow>(
      `SELECT
         token_id,
         tenant_id,
         display_name,
         role,
         device_id,
         scopes_json,
         secret_salt,
         secret_hash,
         kdf,
         issued_at,
         expires_at,
         revoked_at,
         created_by_json,
         created_at,
         updated_at
       FROM auth_tokens
       WHERE token_id = ?
       LIMIT 1`,
      [tokenId],
    );
    return row ? toRow(row) : undefined;
  }

  async insert(input: {
    tokenId: string;
    tenantId: string | null;
    displayName: string;
    role: AuthTokenRole;
    deviceId?: string | null;
    scopesJson: string;
    secretSalt: string;
    secretHash: string;
    kdf: string;
    issuedAt: string;
    expiresAt?: string | null;
    createdByJson?: string;
    createdAt: string;
    updatedAt: string;
  }): Promise<AuthTokenRow> {
    const row = await this.db.get<RawAuthTokenRow>(
      `INSERT INTO auth_tokens (
         token_id,
         tenant_id,
         display_name,
         role,
         device_id,
         scopes_json,
         secret_salt,
         secret_hash,
         kdf,
         issued_at,
         expires_at,
         created_by_json,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING
         token_id,
         tenant_id,
         display_name,
         role,
         device_id,
         scopes_json,
         secret_salt,
         secret_hash,
         kdf,
         issued_at,
         expires_at,
         revoked_at,
         created_by_json,
         created_at,
         updated_at`,
      [
        input.tokenId,
        input.tenantId,
        input.displayName,
        input.role,
        input.deviceId ?? null,
        input.scopesJson,
        input.secretSalt,
        input.secretHash,
        input.kdf,
        input.issuedAt,
        input.expiresAt ?? null,
        input.createdByJson ?? "{}",
        input.createdAt,
        input.updatedAt,
      ],
    );
    if (!row) {
      throw new Error("auth_tokens insert failed");
    }
    return toRow(row);
  }

  async updateById(input: {
    tokenId: string;
    displayName: string;
    role: AuthTokenRole;
    deviceId?: string | null;
    scopesJson: string;
    expiresAt?: string | null;
    updatedAt: string;
  }): Promise<AuthTokenRow | undefined> {
    const row = await this.db.get<RawAuthTokenRow>(
      `UPDATE auth_tokens
       SET display_name = ?,
           role = ?,
           device_id = ?,
           scopes_json = ?,
           expires_at = ?,
           updated_at = ?
       WHERE token_id = ? AND revoked_at IS NULL
       RETURNING
         token_id,
         tenant_id,
         display_name,
         role,
         device_id,
         scopes_json,
         secret_salt,
         secret_hash,
         kdf,
         issued_at,
         expires_at,
         revoked_at,
         created_by_json,
         created_at,
         updated_at`,
      [
        input.displayName,
        input.role,
        input.deviceId ?? null,
        input.scopesJson,
        input.expiresAt ?? null,
        input.updatedAt,
        input.tokenId,
      ],
    );
    return row ? toRow(row) : undefined;
  }

  async revoke(tokenId: string, nowIso: string): Promise<boolean> {
    const row = await this.db.get<{ token_id: string }>(
      `UPDATE auth_tokens
       SET revoked_at = ?
       WHERE token_id = ? AND revoked_at IS NULL
       RETURNING token_id`,
      [nowIso, tokenId],
    );
    return Boolean(row?.token_id);
  }

  async countActiveTenantTokens(tenantId: string): Promise<number> {
    const row = await this.db.get<{ count: number }>(
      `SELECT COUNT(1) AS count
       FROM auth_tokens
       WHERE tenant_id = ? AND revoked_at IS NULL`,
      [tenantId],
    );
    return row?.count ?? 0;
  }

  async countActiveTenantAdminTokens(tenantId: string): Promise<number> {
    const row = await this.db.get<{ count: number }>(
      `SELECT COUNT(1) AS count
       FROM auth_tokens
       WHERE tenant_id = ? AND role = 'admin' AND revoked_at IS NULL`,
      [tenantId],
    );
    return row?.count ?? 0;
  }

  async countActiveSystemTokens(): Promise<number> {
    const row = await this.db.get<{ count: number }>(
      `SELECT COUNT(1) AS count
       FROM auth_tokens
       WHERE tenant_id IS NULL AND revoked_at IS NULL`,
      [],
    );
    return row?.count ?? 0;
  }
}
