/**
 * Admin token management for gateway authentication.
 *
 * Token resolution order:
 * 1. GATEWAY_TOKEN environment variable
 * 2. {tyrumHome}/.admin-token file
 * 3. Generate a new random token and persist to .admin-token
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { MAX_DEVICE_TOKEN_TTL_SECONDS } from "@tyrum/schemas";

const TOKEN_FILENAME = ".admin-token";
const DEVICE_TOKEN_REVOCATIONS_FILENAME = ".device-token-revocations.json";
const DEVICE_TOKEN_PREFIX = "tyrum-device.v1";
const DEFAULT_DEVICE_TOKEN_TTL_SECONDS = 15 * 60;

export type DeviceTokenRole = "client" | "node";

export interface DeviceTokenIssueInput {
  deviceId: string;
  role: DeviceTokenRole;
  scopes?: string[];
  ttlSeconds?: number;
}

export interface DeviceTokenIssueResult {
  token_kind: "device";
  token: string;
  token_id: string;
  device_id: string;
  role: DeviceTokenRole;
  scopes: string[];
  issued_at: string;
  expires_at: string;
}

export interface AuthTokenClaims {
  token_kind: "admin" | "device";
  role: "admin" | DeviceTokenRole;
  scopes: string[];
  token_id?: string;
  device_id?: string;
  issued_at?: string;
  expires_at?: string;
}

interface DeviceTokenPayload {
  v: 1;
  kind: "device";
  jti: string;
  device_id: string;
  role: DeviceTokenRole;
  scopes: string[];
  iat: number;
  exp: number;
}

interface ParseDeviceTokenOptions {
  allowExpired?: boolean;
  allowRevoked?: boolean;
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  if (!Array.isArray(scopes)) return [];
  const normalized = scopes
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
  return [...new Set(normalized)];
}

function toBase64UrlUtf8(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

function fromBase64UrlUtf8(value: string): string | undefined {
  try {
    return Buffer.from(value, "base64url").toString("utf-8");
  } catch {
    return undefined;
  }
}

function isDeviceTokenRole(value: unknown): value is DeviceTokenRole {
  return value === "client" || value === "node";
}

function toDeviceTokenPayload(value: unknown): DeviceTokenPayload | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record["v"] !== 1 || record["kind"] !== "device") return undefined;

  const tokenId = record["jti"];
  const deviceId = record["device_id"];
  const role = record["role"];
  const scopesRaw = record["scopes"];
  const issuedAt = record["iat"];
  const expiresAt = record["exp"];

  if (typeof tokenId !== "string" || tokenId.trim().length === 0) return undefined;
  if (typeof deviceId !== "string" || deviceId.trim().length === 0) return undefined;
  if (!isDeviceTokenRole(role)) return undefined;
  if (!Array.isArray(scopesRaw) || scopesRaw.some((scope) => typeof scope !== "string")) return undefined;
  if (typeof issuedAt !== "number" || !Number.isInteger(issuedAt)) return undefined;
  if (typeof expiresAt !== "number" || !Number.isInteger(expiresAt)) return undefined;
  if (expiresAt <= issuedAt) return undefined;

  const scopes = normalizeScopes(scopesRaw as string[]);
  return {
    v: 1,
    kind: "device",
    jti: tokenId.trim(),
    device_id: deviceId.trim(),
    role,
    scopes,
    iat: issuedAt,
    exp: expiresAt,
  };
}

export class TokenStore {
  private token: string | undefined;
  private revokedDeviceTokenIds = new Set<string>();

  constructor(private readonly tyrumHome: string) {}

  /**
   * Resolve the admin token. Reads from env, then file, or generates a new one.
   * Must be called before validate() or getToken().
   */
  async initialize(): Promise<string> {
    // 1. Environment variable takes precedence
    const envToken = process.env["GATEWAY_TOKEN"]?.trim();
    if (envToken) {
      this.token = envToken;
      await this.loadRevokedDeviceTokenIds();
      return this.token;
    }

    // 2. Try reading from file
    const tokenPath = join(this.tyrumHome, TOKEN_FILENAME);
    try {
      const fileContent = await readFile(tokenPath, "utf-8");
      const trimmed = fileContent.trim();
      if (trimmed) {
        this.token = trimmed;
        await this.loadRevokedDeviceTokenIds();
        return this.token;
      }
    } catch {
      // File doesn't exist or is unreadable — fall through to generation.
    }

    // 3. Generate a new token and persist it
    this.token = randomBytes(32).toString("hex");
    await mkdir(this.tyrumHome, { recursive: true });
    await writeFile(tokenPath, this.token + "\n", { mode: 0o600 });
    await this.loadRevokedDeviceTokenIds();
    return this.token;
  }

  /**
   * Validate a candidate token against the stored admin token.
   * Uses timing-safe comparison to prevent timing attacks.
   * Device tokens are intentionally excluded from this gate.
   */
  validate(candidate: string): boolean {
    if (!this.token) return false;
    const token = candidate.trim();
    if (!token) return false;
    return this.isAdminToken(token);
  }

  authenticate(
    candidate: string | undefined,
    opts?: {
      expectedRole?: DeviceTokenRole;
      expectedDeviceId?: string;
    },
  ): AuthTokenClaims | null {
    if (!this.token) return null;
    const token = candidate?.trim();
    if (!token) return null;

    if (this.isAdminToken(token)) {
      return {
        token_kind: "admin",
        role: "admin",
        scopes: ["*"],
      };
    }

    const payload = this.parseDeviceToken(token, { allowExpired: false, allowRevoked: false });
    if (!payload) return null;
    if (opts?.expectedRole && payload.role !== opts.expectedRole) return null;

    const expectedDeviceId = opts?.expectedDeviceId?.trim();
    if (expectedDeviceId && payload.device_id !== expectedDeviceId) return null;

    return this.payloadToClaims(payload);
  }

  inspectDeviceToken(candidate: string): AuthTokenClaims | null {
    if (!this.token) return null;
    const token = candidate.trim();
    if (!token) return null;
    const payload = this.parseDeviceToken(token, {
      allowExpired: true,
      allowRevoked: true,
    });
    if (!payload) return null;
    return this.payloadToClaims(payload);
  }

  async issueDeviceToken(input: DeviceTokenIssueInput): Promise<DeviceTokenIssueResult> {
    if (!this.token) {
      throw new Error("TokenStore must be initialized before issuing device tokens.");
    }

    const deviceId = input.deviceId.trim();
    if (!deviceId) {
      throw new Error("deviceId is required");
    }
    if (!isDeviceTokenRole(input.role)) {
      throw new Error("role must be 'client' or 'node'");
    }

    const ttlSeconds = input.ttlSeconds ?? DEFAULT_DEVICE_TOKEN_TTL_SECONDS;
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_DEVICE_TOKEN_TTL_SECONDS) {
      throw new Error(`ttlSeconds must be an integer between 1 and ${String(MAX_DEVICE_TOKEN_TTL_SECONDS)}`);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const payload: DeviceTokenPayload = {
      v: 1,
      kind: "device",
      jti: randomUUID(),
      device_id: deviceId,
      role: input.role,
      scopes: normalizeScopes(input.scopes),
      iat: nowSeconds,
      exp: nowSeconds + ttlSeconds,
    };
    const encodedPayload = toBase64UrlUtf8(JSON.stringify(payload));
    const signature = this.signDeviceTokenPayload(encodedPayload);
    const token = `${DEVICE_TOKEN_PREFIX}.${encodedPayload}.${signature}`;

    return {
      token_kind: "device",
      token,
      token_id: payload.jti,
      device_id: payload.device_id,
      role: payload.role,
      scopes: payload.scopes,
      issued_at: new Date(payload.iat * 1000).toISOString(),
      expires_at: new Date(payload.exp * 1000).toISOString(),
    };
  }

  async revokeDeviceToken(candidate: string): Promise<boolean> {
    if (!this.token) return false;
    const token = candidate.trim();
    if (!token) return false;

    const payload = this.parseDeviceToken(token, {
      allowExpired: true,
      allowRevoked: true,
    });
    if (!payload) return false;
    if (this.revokedDeviceTokenIds.has(payload.jti)) return false;

    const nextRevokedDeviceTokenIds = new Set(this.revokedDeviceTokenIds);
    nextRevokedDeviceTokenIds.add(payload.jti);
    await this.persistRevokedDeviceTokenIds(nextRevokedDeviceTokenIds);
    this.revokedDeviceTokenIds = nextRevokedDeviceTokenIds;
    return true;
  }

  /** Get the current token (undefined until initialize() is called). */
  getToken(): string | undefined {
    return this.token;
  }

  private payloadToClaims(payload: DeviceTokenPayload): AuthTokenClaims {
    return {
      token_kind: "device",
      token_id: payload.jti,
      device_id: payload.device_id,
      role: payload.role,
      scopes: payload.scopes,
      issued_at: new Date(payload.iat * 1000).toISOString(),
      expires_at: new Date(payload.exp * 1000).toISOString(),
    };
  }

  private parseDeviceToken(token: string, opts?: ParseDeviceTokenOptions): DeviceTokenPayload | undefined {
    if (!this.token) return undefined;
    const prefix = `${DEVICE_TOKEN_PREFIX}.`;
    if (!token.startsWith(prefix)) return undefined;
    const remainder = token.slice(prefix.length);
    const parts = remainder.split(".");
    if (parts.length !== 2) return undefined;

    const [encodedPayload, providedSignature] = parts;
    if (!encodedPayload || !providedSignature) return undefined;
    if (!this.verifyDeviceTokenSignature(encodedPayload, providedSignature)) return undefined;

    const decoded = fromBase64UrlUtf8(encodedPayload);
    if (!decoded) return undefined;

    let payloadUnknown: unknown;
    try {
      payloadUnknown = JSON.parse(decoded) as unknown;
    } catch {
      return undefined;
    }
    const payload = toDeviceTokenPayload(payloadUnknown);
    if (!payload) return undefined;

    if (!opts?.allowExpired) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (payload.exp <= nowSeconds) return undefined;
    }
    if (!opts?.allowRevoked && this.revokedDeviceTokenIds.has(payload.jti)) {
      return undefined;
    }

    return payload;
  }

  private signDeviceTokenPayload(encodedPayload: string): string {
    const key = Buffer.from(this.token ?? "", "utf-8");
    return createHmac("sha256", key).update(encodedPayload, "utf-8").digest("base64url");
  }

  private verifyDeviceTokenSignature(encodedPayload: string, providedSignature: string): boolean {
    const expectedSignature = this.signDeviceTokenPayload(encodedPayload);
    const expected = Buffer.from(expectedSignature, "utf-8");
    const actual = Buffer.from(providedSignature, "utf-8");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  private isAdminToken(candidate: string): boolean {
    if (!this.token) return false;
    const expected = Buffer.from(this.token, "utf-8");
    const actual = Buffer.from(candidate, "utf-8");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  private getRevocationPath(): string {
    return join(this.tyrumHome, DEVICE_TOKEN_REVOCATIONS_FILENAME);
  }

  private async loadRevokedDeviceTokenIds(): Promise<void> {
    const revocationPath = this.getRevocationPath();
    try {
      const raw = await readFile(revocationPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        this.revokedDeviceTokenIds = new Set<string>();
        return;
      }
      const ids = parsed
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      this.revokedDeviceTokenIds = new Set(ids);
    } catch {
      this.revokedDeviceTokenIds = new Set<string>();
    }
  }

  private async persistRevokedDeviceTokenIds(ids: Iterable<string> = this.revokedDeviceTokenIds): Promise<void> {
    const revocationPath = this.getRevocationPath();
    await mkdir(this.tyrumHome, { recursive: true });
    const sortedIds = [...ids].sort();
    await writeFile(revocationPath, JSON.stringify(sortedIds, null, 2) + "\n", {
      mode: 0o600,
    });
  }
}
