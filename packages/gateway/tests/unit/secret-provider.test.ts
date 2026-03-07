import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { createDbSecretProvider } from "../../src/modules/secret/create-secret-provider.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import {
  createSharedSecretKeyProvider,
  SHARED_MASTER_KEY_ENV_VAR,
} from "../../src/modules/secret/key-provider.js";

describe("DbSecretProvider", () => {
  let tempDir: string;
  let dbPath: string;
  let tyrumHome: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-db-secret-provider-test-"));
    dbPath = join(tempDir, "gateway.db");
    tyrumHome = join(tempDir, "home");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a master key file and roundtrips secret values (encrypted at rest)", async () => {
    const db = openTestSqliteDb(dbPath);
    try {
      const provider = await createDbSecretProvider({
        db,
        dbPath,
        tyrumHome,
        tenantId: DEFAULT_TENANT_ID,
      });

      const handle = await provider.store("db_password", "super-secret-123");
      expect(handle.provider).toBe("db");
      expect(handle.handle_id).toBe("db_password");
      expect(handle.scope).toBe("db_password");

      const resolved = await provider.resolve(handle);
      expect(resolved).toBe("super-secret-123");

      const keyPath = join(tyrumHome, "master.key");
      const stat = statSync(keyPath);
      if (process.platform !== "win32") {
        expect(stat.mode & 0o777).toBe(0o600);
      }

      const version1 = await db.get<{
        version: number;
        alg: string;
        key_id: string;
        nonce: Buffer;
        ciphertext: Buffer;
      }>(
        `SELECT version, alg, key_id, nonce, ciphertext
         FROM secret_versions
         WHERE tenant_id = ? AND secret_id = (
           SELECT secret_id FROM secrets WHERE tenant_id = ? AND secret_key = ?
         )
         ORDER BY version ASC
         LIMIT 1`,
        [DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, "db_password"],
      );
      expect(version1).toBeTruthy();
      expect(version1!.version).toBe(1);
      expect(version1!.alg).toBe("aes-256-gcm");
      expect(version1!.key_id.length).toBeGreaterThan(0);
      expect(version1!.nonce.length).toBe(12);
      expect(version1!.ciphertext.length).toBeGreaterThan(16);
      expect(version1!.ciphertext.equals(Buffer.from("super-secret-123", "utf8"))).toBe(false);
    } finally {
      await db.close();
    }
  });

  it("rotates by creating a new version while keeping handle_id stable", async () => {
    const db = openTestSqliteDb(dbPath);
    try {
      const provider = await createDbSecretProvider({
        db,
        dbPath,
        tyrumHome,
        tenantId: DEFAULT_TENANT_ID,
      });

      const handle = await provider.store("api_key", "v1");
      expect(await provider.resolve(handle)).toBe("v1");

      const handle2 = await provider.store("api_key", "v2");
      expect(handle2.handle_id).toBe("api_key");
      expect(await provider.resolve(handle2)).toBe("v2");

      const meta = await db.get<{ current_version: number }>(
        `SELECT current_version FROM secrets WHERE tenant_id = ? AND secret_key = ?`,
        [DEFAULT_TENANT_ID, "api_key"],
      );
      expect(meta?.current_version).toBe(2);

      const versions = await db.all<{ version: number }>(
        `SELECT version
         FROM secret_versions
         WHERE tenant_id = ? AND secret_id = (
           SELECT secret_id FROM secrets WHERE tenant_id = ? AND secret_key = ?
         )
         ORDER BY version ASC`,
        [DEFAULT_TENANT_ID, DEFAULT_TENANT_ID, "api_key"],
      );
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
    } finally {
      await db.close();
    }
  });

  it("revoke makes the secret unresolvable and excludes it from list()", async () => {
    const db = openTestSqliteDb(dbPath);
    try {
      const provider = await createDbSecretProvider({
        db,
        dbPath,
        tyrumHome,
        tenantId: DEFAULT_TENANT_ID,
      });

      const handle = await provider.store("to_revoke", "value");
      expect(await provider.resolve(handle)).toBe("value");

      const revoked = await provider.revoke(handle.handle_id);
      expect(revoked).toBe(true);
      expect(await provider.resolve(handle)).toBeNull();
      expect(await provider.list()).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("roundtrips secrets with a shared key provider and avoids local master.key writes", async () => {
    const db = openTestSqliteDb(dbPath);
    const previous = process.env[SHARED_MASTER_KEY_ENV_VAR];
    process.env[SHARED_MASTER_KEY_ENV_VAR] = Buffer.alloc(32, 9).toString("base64");

    try {
      const provider = await createDbSecretProvider({
        db,
        dbPath,
        tyrumHome,
        tenantId: DEFAULT_TENANT_ID,
        keyProvider: createSharedSecretKeyProvider(),
      });

      const handle = await provider.store("shared_secret", "value-from-shared-key");

      expect(await provider.resolve(handle)).toBe("value-from-shared-key");
      expect(existsSync(join(tyrumHome, "master.key"))).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env[SHARED_MASTER_KEY_ENV_VAR];
      } else {
        process.env[SHARED_MASTER_KEY_ENV_VAR] = previous;
      }
      await db.close();
    }
  });
});
