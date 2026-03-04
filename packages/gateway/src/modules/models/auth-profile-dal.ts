import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";

export type AuthProfileType = "api_key" | "oauth" | "token";
export type AuthProfileStatus = "active" | "disabled";

export interface AuthProfileRow {
  tenant_id: string;
  auth_profile_id: string;
  auth_profile_key: string;
  provider_key: string;
  type: AuthProfileType;
  status: AuthProfileStatus;
  secret_keys: Record<string, string>;
  labels: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface RawAuthProfileRow {
  tenant_id: string;
  auth_profile_id: string;
  auth_profile_key: string;
  provider_key: string;
  type: string;
  status: string;
  labels_json: unknown;
  created_at: string | Date;
  updated_at: string | Date;
}

type RawSecretSlotRow = {
  auth_profile_id: string;
  slot_key: string;
  secret_key: string;
};

type RawSecretLookupRow = {
  secret_key: string;
  secret_id: string;
  status: string;
};

function normalizeTime(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function parseJson(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : fallback;
    } catch {
      // Intentional: tolerate invalid JSON in persisted rows.
      return fallback;
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return fallback;
}

function normalizeAuthProfileType(value: string): AuthProfileType {
  return value === "oauth" || value === "token" ? value : "api_key";
}

function normalizeAuthProfileStatus(value: string): AuthProfileStatus {
  return value === "disabled" ? "disabled" : "active";
}

function normalizeSecretKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("secret_key is required");
  }
  return trimmed;
}

function normalizeSlotKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("slot_key is required");
  }
  return trimmed;
}

async function loadSecretKeysByProfileId(db: SqlDb, tenantId: string, authProfileIds: string[]) {
  const mapping = new Map<string, Record<string, string>>();
  for (const id of authProfileIds) mapping.set(id, {});
  if (authProfileIds.length === 0) return mapping;

  const placeholders = authProfileIds.map(() => "?").join(", ");
  const rows = await db.all<RawSecretSlotRow>(
    `SELECT aps.auth_profile_id, aps.slot_key, s.secret_key
     FROM auth_profile_secrets aps
     JOIN secrets s
       ON s.tenant_id = aps.tenant_id
      AND s.secret_id = aps.secret_id
     WHERE aps.tenant_id = ?
       AND aps.auth_profile_id IN (${placeholders})
     ORDER BY aps.auth_profile_id ASC, aps.slot_key ASC`,
    [tenantId, ...authProfileIds],
  );

  for (const row of rows) {
    const slots = mapping.get(row.auth_profile_id);
    if (!slots) continue;
    slots[row.slot_key] = row.secret_key;
  }

  return mapping;
}

function toRow(raw: RawAuthProfileRow, secretKeys: Record<string, string>): AuthProfileRow {
  return {
    tenant_id: raw.tenant_id,
    auth_profile_id: raw.auth_profile_id,
    auth_profile_key: raw.auth_profile_key,
    provider_key: raw.provider_key,
    type: normalizeAuthProfileType(raw.type),
    status: normalizeAuthProfileStatus(raw.status),
    secret_keys: secretKeys,
    labels: parseJson(raw.labels_json, {}),
    created_at: normalizeTime(raw.created_at) ?? new Date().toISOString(),
    updated_at: normalizeTime(raw.updated_at) ?? new Date().toISOString(),
  };
}

export class AuthProfileDal {
  constructor(private readonly db: SqlDb) {}

  async getByKey(input: {
    tenantId: string;
    authProfileKey: string;
  }): Promise<AuthProfileRow | undefined> {
    const row = await this.db.get<RawAuthProfileRow>(
      `SELECT *
       FROM auth_profiles
       WHERE tenant_id = ? AND auth_profile_key = ?
       LIMIT 1`,
      [input.tenantId, input.authProfileKey],
    );
    if (!row) return undefined;
    const secrets = await loadSecretKeysByProfileId(this.db, input.tenantId, [row.auth_profile_id]);
    return toRow(row, secrets.get(row.auth_profile_id) ?? {});
  }

  async list(input: {
    tenantId: string;
    providerKey?: string;
    status?: AuthProfileStatus;
    limit?: number;
  }): Promise<AuthProfileRow[]> {
    const where: string[] = ["tenant_id = ?"];
    const values: unknown[] = [input.tenantId];

    if (input.providerKey) {
      where.push("provider_key = ?");
      values.push(input.providerKey);
    }
    if (input.status) {
      where.push("status = ?");
      values.push(input.status);
    }

    const limit = Math.max(1, Math.min(500, input.limit ?? 200));
    const sql = `SELECT *
       FROM auth_profiles
       WHERE ${where.join(" AND ")}
       ORDER BY created_at ASC, auth_profile_key ASC
       LIMIT ${String(limit)}`;

    const rows = await this.db.all<RawAuthProfileRow>(sql, values);
    const secretsById = await loadSecretKeysByProfileId(
      this.db,
      input.tenantId,
      rows.map((r) => r.auth_profile_id),
    );

    return rows.map((row) => toRow(row, secretsById.get(row.auth_profile_id) ?? {}));
  }

  async create(input: {
    tenantId: string;
    authProfileKey: string;
    providerKey: string;
    type: AuthProfileType;
    secretKeys?: Record<string, string>;
    labels?: Record<string, unknown>;
  }): Promise<AuthProfileRow> {
    const nowIso = new Date().toISOString();
    const authProfileId = randomUUID();
    const labelsJson = JSON.stringify(input.labels ?? {});

    const desiredSecretKeys = Object.entries(input.secretKeys ?? {}).map(
      ([slotKey, secretKey]) => ({
        slotKey: normalizeSlotKey(slotKey),
        secretKey: normalizeSecretKey(secretKey),
      }),
    );
    const uniqueSecretKeys = [...new Set(desiredSecretKeys.map((e) => e.secretKey))];

    await this.db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO auth_profiles (
           tenant_id,
           auth_profile_id,
           auth_profile_key,
           provider_key,
           type,
           status,
           labels_json,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        [
          input.tenantId,
          authProfileId,
          input.authProfileKey,
          input.providerKey,
          input.type,
          labelsJson,
          nowIso,
          nowIso,
        ],
      );

      if (desiredSecretKeys.length === 0) return;

      const placeholders = uniqueSecretKeys.map(() => "?").join(", ");
      const rows = await tx.all<RawSecretLookupRow>(
        `SELECT secret_key, secret_id, status
         FROM secrets
         WHERE tenant_id = ? AND secret_key IN (${placeholders})`,
        [input.tenantId, ...uniqueSecretKeys],
      );

      const secretIdByKey = new Map<string, string>();
      for (const row of rows) {
        if (row.status !== "active") continue;
        secretIdByKey.set(row.secret_key, row.secret_id);
      }

      for (const { slotKey, secretKey } of desiredSecretKeys) {
        const secretId = secretIdByKey.get(secretKey);
        if (!secretId) {
          throw new Error(`secret '${secretKey}' not found (or revoked)`);
        }
        await tx.run(
          `INSERT INTO auth_profile_secrets (
             tenant_id,
             auth_profile_id,
             slot_key,
             secret_id
           ) VALUES (?, ?, ?, ?)`,
          [input.tenantId, authProfileId, slotKey, secretId],
        );
      }
    });

    const row = await this.getByKey({
      tenantId: input.tenantId,
      authProfileKey: input.authProfileKey,
    });
    if (!row) {
      throw new Error("auth profile create failed");
    }
    return row;
  }

  async updateByKey(input: {
    tenantId: string;
    authProfileKey: string;
    labels?: Record<string, unknown>;
    secretKeys?: Record<string, string>;
  }): Promise<AuthProfileRow | undefined> {
    const nowIso = new Date().toISOString();

    const desiredSecretKeys =
      input.secretKeys === undefined
        ? undefined
        : Object.entries(input.secretKeys).map(([slotKey, secretKey]) => ({
            slotKey: normalizeSlotKey(slotKey),
            secretKey: normalizeSecretKey(secretKey),
          }));

    await this.db.transaction(async (tx) => {
      const existing = await tx.get<{ auth_profile_id: string }>(
        `SELECT auth_profile_id
         FROM auth_profiles
         WHERE tenant_id = ? AND auth_profile_key = ?
         LIMIT 1`,
        [input.tenantId, input.authProfileKey],
      );
      if (!existing) return;

      if (input.labels !== undefined) {
        await tx.run(
          `UPDATE auth_profiles
           SET labels_json = ?, updated_at = ?
           WHERE tenant_id = ? AND auth_profile_id = ?`,
          [JSON.stringify(input.labels), nowIso, input.tenantId, existing.auth_profile_id],
        );
      } else {
        await tx.run(
          `UPDATE auth_profiles
           SET updated_at = ?
           WHERE tenant_id = ? AND auth_profile_id = ?`,
          [nowIso, input.tenantId, existing.auth_profile_id],
        );
      }

      if (desiredSecretKeys === undefined) return;

      await tx.run(
        `DELETE FROM auth_profile_secrets
         WHERE tenant_id = ? AND auth_profile_id = ?`,
        [input.tenantId, existing.auth_profile_id],
      );

      if (desiredSecretKeys.length === 0) return;

      const uniqueSecretKeys = [...new Set(desiredSecretKeys.map((e) => e.secretKey))];
      const placeholders = uniqueSecretKeys.map(() => "?").join(", ");
      const rows = await tx.all<RawSecretLookupRow>(
        `SELECT secret_key, secret_id, status
         FROM secrets
         WHERE tenant_id = ? AND secret_key IN (${placeholders})`,
        [input.tenantId, ...uniqueSecretKeys],
      );

      const secretIdByKey = new Map<string, string>();
      for (const row of rows) {
        if (row.status !== "active") continue;
        secretIdByKey.set(row.secret_key, row.secret_id);
      }

      for (const { slotKey, secretKey } of desiredSecretKeys) {
        const secretId = secretIdByKey.get(secretKey);
        if (!secretId) {
          throw new Error(`secret '${secretKey}' not found (or revoked)`);
        }
        await tx.run(
          `INSERT INTO auth_profile_secrets (
             tenant_id,
             auth_profile_id,
             slot_key,
             secret_id
           ) VALUES (?, ?, ?, ?)`,
          [input.tenantId, existing.auth_profile_id, slotKey, secretId],
        );
      }
    });

    return await this.getByKey({ tenantId: input.tenantId, authProfileKey: input.authProfileKey });
  }

  async disableByKey(input: {
    tenantId: string;
    authProfileKey: string;
  }): Promise<AuthProfileRow | undefined> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE auth_profiles
       SET status = 'disabled', updated_at = ?
       WHERE tenant_id = ? AND auth_profile_key = ?`,
      [nowIso, input.tenantId, input.authProfileKey],
    );
    return await this.getByKey(input);
  }

  async enableByKey(input: {
    tenantId: string;
    authProfileKey: string;
  }): Promise<AuthProfileRow | undefined> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE auth_profiles
       SET status = 'active', updated_at = ?
       WHERE tenant_id = ? AND auth_profile_key = ?`,
      [nowIso, input.tenantId, input.authProfileKey],
    );
    return await this.getByKey(input);
  }
}
