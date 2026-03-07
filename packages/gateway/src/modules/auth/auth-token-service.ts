import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { AuthTokenClaims } from "@tyrum/schemas";
import { AuthTokenDal, type AuthTokenRole, type AuthTokenRow } from "./auth-token-dal.js";
import type { SqlDb } from "../../statestore/types.js";

const TOKEN_PREFIX = "tyrum-token";
const TOKEN_VERSION = "v1";

function normalizeScopes(scopes: string[] | undefined): string[] {
  if (!Array.isArray(scopes)) return [];
  const normalized = scopes.map((scope) => scope.trim()).filter((scope) => scope.length > 0);
  return [...new Set(normalized)];
}

function parseScopesJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeScopes(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    // Intentional: treat invalid scope JSON as empty (fail closed).
    return [];
  }
}

function encodeBase64Url(buf: Buffer): string {
  return buf.toString("base64url");
}

function decodeBase64Url(raw: string): Buffer | undefined {
  try {
    const buf = Buffer.from(raw, "base64url");
    return buf.length > 0 ? buf : undefined;
  } catch {
    // Intentional: invalid base64url means the token is malformed (fail closed).
    return undefined;
  }
}

function formatToken(parts: { tokenId: string; secretB64Url: string }): string {
  return `${TOKEN_PREFIX}.${TOKEN_VERSION}.${parts.tokenId}.${parts.secretB64Url}`;
}

function parseToken(tokenRaw: string): { tokenId: string; secretB64Url: string } | undefined {
  const token = tokenRaw.trim();
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length !== 4) return undefined;
  const [prefix, version, tokenId, secretB64Url] = parts;
  if (prefix !== TOKEN_PREFIX) return undefined;
  if (version !== TOKEN_VERSION) return undefined;
  if (!tokenId || !secretB64Url) return undefined;
  return { tokenId, secretB64Url };
}

function isExpired(expiresAtIso: string | null, nowMs: number): boolean {
  if (!expiresAtIso) return false;
  const t = Date.parse(expiresAtIso);
  if (!Number.isFinite(t)) return false;
  return t <= nowMs;
}

function deriveScryptHash(secret: Buffer, salt: Buffer): Buffer {
  // Defaults match Node's built-in scrypt parameters (N=16384, r=8, p=1).
  return scryptSync(secret, salt, 32);
}

function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf-8");
  const bBuf = Buffer.from(b, "utf-8");
  const maxLength = Math.max(aBuf.length, bBuf.length, 1);
  const paddedA = Buffer.alloc(maxLength);
  const paddedB = Buffer.alloc(maxLength);
  aBuf.copy(paddedA);
  bBuf.copy(paddedB);
  return timingSafeEqual(paddedA, paddedB) && aBuf.length === bBuf.length;
}

export type ProvisionedAuthToken = {
  token: string;
  tenantId: string | null;
  role: AuthTokenRole;
  scopes?: string[];
  deviceId?: string;
  tokenId?: string;
};

type NormalizedProvisionedAuthToken = {
  token: string;
  claims: AuthTokenClaims;
};

export class AuthTokenService {
  private readonly dal: AuthTokenDal;
  private readonly provisionedTokens: readonly NormalizedProvisionedAuthToken[];

  constructor(
    db: SqlDb,
    private readonly opts?: {
      nowMs?: () => number;
      provisionedTokens?: ProvisionedAuthToken[];
    },
  ) {
    this.dal = new AuthTokenDal(db);
    this.provisionedTokens = normalizeProvisionedTokens(opts?.provisionedTokens);
  }

  async authenticate(
    candidate: string | undefined,
    opts?: {
      expectedRole?: AuthTokenRole;
      expectedDeviceId?: string;
    },
  ): Promise<AuthTokenClaims | null> {
    const tokenRaw = candidate?.trim();
    if (!tokenRaw) return null;

    const parsed = parseToken(tokenRaw);
    if (parsed) {
      const row = await this.dal.getById(parsed.tokenId);
      if (!row) return this.authenticateProvisionedToken(tokenRaw, opts);
      if (row.revoked_at) return null;

      const nowMs = this.opts?.nowMs?.() ?? Date.now();
      if (isExpired(row.expires_at, nowMs)) return null;

      if (row.kdf !== "scrypt") return null;

      const secret = decodeBase64Url(parsed.secretB64Url);
      const salt = decodeBase64Url(row.secret_salt);
      const expectedHash = decodeBase64Url(row.secret_hash);
      if (!secret || !salt || !expectedHash) return null;

      const actualHash = deriveScryptHash(secret, salt);
      if (!constantTimeEqual(actualHash, expectedHash)) return null;

      const expectedRole = opts?.expectedRole;
      if (expectedRole && row.role !== expectedRole) return null;

      const expectedDeviceId = opts?.expectedDeviceId?.trim();
      if (expectedDeviceId && row.device_id !== expectedDeviceId) return null;

      const scopes = parseScopesJson(row.scopes_json);

      return {
        token_kind: row.role === "admin" ? "admin" : "device",
        token_id: row.token_id,
        tenant_id: row.tenant_id,
        device_id: row.device_id ?? undefined,
        role: row.role,
        scopes,
        issued_at: row.issued_at,
        expires_at: row.expires_at ?? undefined,
      };
    }

    return this.authenticateProvisionedToken(tokenRaw, opts);
  }

  async issueToken(input: {
    tenantId: string | null;
    role: AuthTokenRole;
    scopes?: string[];
    deviceId?: string;
    ttlSeconds?: number;
    createdByJson?: string;
  }): Promise<{ token: string; row: AuthTokenRow }> {
    const nowMs = Date.now();
    const issuedAt = new Date(nowMs).toISOString();

    const ttlSeconds = input.ttlSeconds;
    const expiresAt =
      typeof ttlSeconds === "number" && Number.isFinite(ttlSeconds) && ttlSeconds > 0
        ? new Date(nowMs + Math.floor(ttlSeconds) * 1000).toISOString()
        : null;

    const tokenId = randomUUID();
    const secret = randomBytes(32);
    const secretB64Url = encodeBase64Url(secret);
    const salt = randomBytes(16);

    const hash = deriveScryptHash(secret, salt);
    const scopes = normalizeScopes(input.scopes);
    const row = await this.dal.insert({
      tokenId,
      tenantId: input.tenantId,
      role: input.role,
      deviceId: input.deviceId?.trim() || null,
      scopesJson: JSON.stringify(scopes),
      secretSalt: encodeBase64Url(salt),
      secretHash: encodeBase64Url(hash),
      kdf: "scrypt",
      issuedAt,
      expiresAt,
      createdByJson: input.createdByJson,
      createdAt: issuedAt,
    });

    return {
      token: formatToken({ tokenId, secretB64Url }),
      row,
    };
  }

  async revokeToken(tokenId: string): Promise<boolean> {
    const id = tokenId.trim();
    if (!id) return false;
    return await this.dal.revoke(id, new Date().toISOString());
  }

  async countActiveTenantTokens(tenantId: string): Promise<number> {
    return (
      (await this.dal.countActiveTenantTokens(tenantId)) +
      this.countProvisionedTokens((entry) => entry.claims.tenant_id === tenantId)
    );
  }

  async countActiveTenantAdminTokens(tenantId: string): Promise<number> {
    return (
      (await this.dal.countActiveTenantAdminTokens(tenantId)) +
      this.countProvisionedTokens(
        (entry) => entry.claims.tenant_id === tenantId && entry.claims.role === "admin",
      )
    );
  }

  async countActiveSystemTokens(): Promise<number> {
    return (
      (await this.dal.countActiveSystemTokens()) +
      this.countProvisionedTokens(
        (entry) => entry.claims.tenant_id === null && entry.claims.role === "admin",
      )
    );
  }

  private authenticateProvisionedToken(
    candidate: string,
    opts?: {
      expectedRole?: AuthTokenRole;
      expectedDeviceId?: string;
    },
  ): AuthTokenClaims | null {
    const expectedRole = opts?.expectedRole;
    const expectedDeviceId = opts?.expectedDeviceId?.trim();
    for (const entry of this.provisionedTokens) {
      if (!constantTimeStringEqual(entry.token, candidate)) continue;
      if (expectedRole && entry.claims.role !== expectedRole) return null;
      if (expectedDeviceId && entry.claims.device_id !== expectedDeviceId) return null;
      return entry.claims;
    }
    return null;
  }

  private countProvisionedTokens(
    predicate: (entry: NormalizedProvisionedAuthToken) => boolean,
  ): number {
    let matches = 0;
    for (const entry of this.provisionedTokens) {
      if (predicate(entry)) matches += 1;
    }
    return matches;
  }
}

function normalizeProvisionedTokens(
  entries: ProvisionedAuthToken[] | undefined,
): readonly NormalizedProvisionedAuthToken[] {
  if (!entries || entries.length === 0) return [];

  const normalized: NormalizedProvisionedAuthToken[] = [];
  for (const [index, entry] of entries.entries()) {
    const token = entry.token.trim();
    if (!token) continue;
    const issuedAt = new Date(0).toISOString();
    normalized.push({
      token,
      claims: {
        token_kind: entry.role === "admin" ? "admin" : "device",
        token_id: entry.tokenId?.trim() || `provisioned-${String(index + 1)}`,
        tenant_id: entry.tenantId,
        device_id: entry.deviceId?.trim() || undefined,
        role: entry.role,
        scopes: normalizeScopes(entry.scopes),
        issued_at: issuedAt,
      },
    });
  }
  return normalized;
}
