import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import type { SecretHandle as SecretHandleT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { isUniqueViolation } from "../../utils/sql-errors.js";

export interface SecretStoreOptions {
  createOnly?: boolean;
}

export class SecretAlreadyExistsError extends Error {
  constructor(readonly secretKey: string) {
    super(`secret ${secretKey} already exists`);
    this.name = "SecretAlreadyExistsError";
  }
}

/** Interface for all secret providers. */
export interface SecretProvider {
  resolve(handle: SecretHandleT): Promise<string | null>;
  store(secretKey: string, value: string, options?: SecretStoreOptions): Promise<SecretHandleT>;
  revoke(handleId: string): Promise<boolean>;
  list(): Promise<SecretHandleT[]>;
}

const DB_SECRET_ALG = "aes-256-gcm";
const DB_SECRET_NONCE_BYTES = 12;
const DB_SECRET_AUTH_TAG_BYTES = 16;

function normalizeTime(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeSecretKey(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("secret_key is required");
  }
  if (/\s/.test(trimmed)) {
    throw new Error("secret_key must not contain whitespace");
  }
  return trimmed;
}

function isSqliteBusyError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" && code.toUpperCase().startsWith("SQLITE_BUSY");
  }
  return false;
}

function encryptValue(masterKey: Buffer, plaintext: string): { nonce: Buffer; ciphertext: Buffer } {
  const nonce = randomBytes(DB_SECRET_NONCE_BYTES);
  const cipher = createCipheriv(DB_SECRET_ALG, masterKey, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { nonce, ciphertext: Buffer.concat([encrypted, tag]) };
}

function decryptValue(masterKey: Buffer, nonce: Buffer, ciphertextAndTag: Buffer): string {
  if (ciphertextAndTag.length <= DB_SECRET_AUTH_TAG_BYTES) {
    throw new Error("ciphertext is too short");
  }
  const tag = ciphertextAndTag.subarray(ciphertextAndTag.length - DB_SECRET_AUTH_TAG_BYTES);
  const ciphertext = ciphertextAndTag.subarray(
    0,
    ciphertextAndTag.length - DB_SECRET_AUTH_TAG_BYTES,
  );

  const decipher = createDecipheriv(DB_SECRET_ALG, masterKey, nonce);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

type SecretRow = {
  secret_id: string;
  secret_key: string;
  status: "active" | "revoked";
  current_version: number;
  created_at: string | Date;
};

type SecretVersionRow = {
  alg: string;
  key_id: string;
  nonce: Buffer;
  ciphertext: Buffer;
  revoked_at: string | Date | null;
};

export class DbSecretProvider implements SecretProvider {
  constructor(
    private readonly db: SqlDb,
    private readonly opts: {
      tenantId: string;
      masterKey: Buffer;
      keyId: string;
    },
  ) {
    if (opts.masterKey.length !== 32) {
      throw new Error("DbSecretProvider masterKey must be 32 bytes");
    }
  }

  async resolve(handle: SecretHandleT): Promise<string | null> {
    const secretKey = normalizeSecretKey(handle.handle_id);

    const secret = await this.db.get<SecretRow>(
      `SELECT secret_id, secret_key, status, current_version, created_at
       FROM secrets
       WHERE tenant_id = ? AND secret_key = ?`,
      [this.opts.tenantId, secretKey],
    );
    if (!secret || secret.status !== "active") return null;

    const version = await this.db.get<SecretVersionRow>(
      `SELECT alg, key_id, nonce, ciphertext, revoked_at
       FROM secret_versions
       WHERE tenant_id = ? AND secret_id = ? AND version = ?`,
      [this.opts.tenantId, secret.secret_id, secret.current_version],
    );
    if (!version || version.revoked_at != null) return null;
    if (version.alg !== DB_SECRET_ALG) {
      throw new Error(`unsupported secret cipher '${version.alg}'`);
    }
    if (version.key_id !== this.opts.keyId) {
      throw new Error(`secret master key mismatch (expected key_id=${this.opts.keyId})`);
    }

    return decryptValue(this.opts.masterKey, version.nonce, version.ciphertext);
  }

  async store(
    secretKeyRaw: string,
    value: string,
    options?: SecretStoreOptions,
  ): Promise<SecretHandleT> {
    const secretKey = normalizeSecretKey(secretKeyRaw);
    const nowIso = new Date().toISOString();

    if (options?.createOnly) {
      const maxBusyRetries = 3;
      for (let attempt = 0; attempt <= maxBusyRetries; attempt += 1) {
        try {
          return await this.db.transaction(async (tx) => {
            const secretId = randomUUID();
            const nextVersion = 1;
            const encrypted = encryptValue(this.opts.masterKey, value);

            try {
              await tx.run(
                `INSERT INTO secrets (
                   tenant_id,
                   secret_id,
                   secret_key,
                   status,
                   current_version,
                   created_at,
                   updated_at
                 ) VALUES (?, ?, ?, 'active', ?, ?, ?)`,
                [this.opts.tenantId, secretId, secretKey, nextVersion, nowIso, nowIso],
              );
            } catch (err) {
              if (isUniqueViolation(err)) {
                throw new SecretAlreadyExistsError(secretKey);
              }
              throw err;
            }

            await tx.run(
              `INSERT INTO secret_versions (
                 tenant_id,
                 secret_id,
                 version,
                 alg,
                 key_id,
                 nonce,
                 ciphertext,
                 created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                this.opts.tenantId,
                secretId,
                nextVersion,
                DB_SECRET_ALG,
                this.opts.keyId,
                encrypted.nonce,
                encrypted.ciphertext,
                nowIso,
              ],
            );

            return {
              handle_id: secretKey,
              provider: "db",
              scope: secretKey,
              created_at: nowIso,
            };
          });
        } catch (err) {
          if (!isSqliteBusyError(err)) {
            throw err;
          }

          const existing = await this.db.get<Pick<SecretRow, "secret_id">>(
            `SELECT secret_id
             FROM secrets
             WHERE tenant_id = ? AND secret_key = ?`,
            [this.opts.tenantId, secretKey],
          );
          if (existing) {
            throw new SecretAlreadyExistsError(secretKey);
          }
          if (attempt === maxBusyRetries) {
            throw err;
          }
        }
      }

      throw new Error("unreachable");
    }

    return await this.db.transaction(async (tx) => {
      const existing = await tx.get<SecretRow>(
        `SELECT secret_id, secret_key, status, current_version, created_at
         FROM secrets
         WHERE tenant_id = ? AND secret_key = ?`,
        [this.opts.tenantId, secretKey],
      );

      const secretId = existing?.secret_id ?? randomUUID();
      const createdAt = normalizeTime(existing?.created_at) ?? nowIso;

      const nextVersion = (() => {
        if (!existing) return 1;
        const current = Number(existing.current_version);
        return Number.isFinite(current) && current >= 1 ? current + 1 : 1;
      })();

      const encrypted = encryptValue(this.opts.masterKey, value);

      if (!existing) {
        await tx.run(
          `INSERT INTO secrets (
             tenant_id,
             secret_id,
             secret_key,
             status,
             current_version,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, 'active', ?, ?, ?)`,
          [this.opts.tenantId, secretId, secretKey, nextVersion, nowIso, nowIso],
        );
      } else {
        await tx.run(
          `UPDATE secrets
           SET status = 'active', current_version = ?, updated_at = ?
           WHERE tenant_id = ? AND secret_id = ?`,
          [nextVersion, nowIso, this.opts.tenantId, secretId],
        );
      }

      await tx.run(
        `INSERT INTO secret_versions (
           tenant_id,
           secret_id,
           version,
           alg,
           key_id,
           nonce,
           ciphertext,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          this.opts.tenantId,
          secretId,
          nextVersion,
          DB_SECRET_ALG,
          this.opts.keyId,
          encrypted.nonce,
          encrypted.ciphertext,
          nowIso,
        ],
      );

      return {
        handle_id: secretKey,
        provider: "db",
        scope: secretKey,
        created_at: createdAt,
      };
    });
  }

  async revoke(handleId: string): Promise<boolean> {
    const secretKey = normalizeSecretKey(handleId);
    const nowIso = new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const secret = await tx.get<Pick<SecretRow, "secret_id" | "current_version">>(
        `SELECT secret_id, current_version
         FROM secrets
         WHERE tenant_id = ? AND secret_key = ? AND status = 'active'`,
        [this.opts.tenantId, secretKey],
      );
      if (!secret) return false;

      await tx.run(
        `UPDATE secrets
         SET status = 'revoked', updated_at = ?
         WHERE tenant_id = ? AND secret_id = ?`,
        [nowIso, this.opts.tenantId, secret.secret_id],
      );

      await tx.run(
        `UPDATE secret_versions
         SET revoked_at = ?
         WHERE tenant_id = ? AND secret_id = ? AND version = ? AND revoked_at IS NULL`,
        [nowIso, this.opts.tenantId, secret.secret_id, secret.current_version],
      );

      return true;
    });
  }

  async list(): Promise<SecretHandleT[]> {
    const rows = await this.db.all<Pick<SecretRow, "secret_key" | "created_at">>(
      `SELECT secret_key, created_at
       FROM secrets
       WHERE tenant_id = ? AND status = 'active'
       ORDER BY created_at ASC, secret_key ASC`,
      [this.opts.tenantId],
    );

    return rows.map((row) => {
      const createdAt = normalizeTime(row.created_at) ?? new Date().toISOString();
      return {
        handle_id: row.secret_key,
        provider: "db",
        scope: row.secret_key,
        created_at: createdAt,
      };
    });
  }
}
