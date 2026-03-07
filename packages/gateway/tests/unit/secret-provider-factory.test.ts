import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  createDbSecretProvider,
  createDbSecretProviderFactory,
} from "../../src/modules/secret/create-secret-provider.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import {
  createSharedSecretKeyProvider,
  SHARED_MASTER_KEY_ENV_VAR,
} from "../../src/modules/secret/key-provider.js";

describe("createDbSecretProvider", () => {
  let tempDir: string;
  let dbPath: string;
  let tyrumHome: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tyrum-secret-provider-factory-"));
    dbPath = join(tempDir, "gateway.db");
    tyrumHome = join(tempDir, "home");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a master key file under tyrumHome for persistent databases", async () => {
    const db = openTestSqliteDb(dbPath);
    try {
      await createDbSecretProvider({ db, dbPath, tyrumHome, tenantId: DEFAULT_TENANT_ID });
      expect(existsSync(join(tyrumHome, "master.key"))).toBe(true);
      expect(existsSync(`${dbPath}.secrets.key`)).toBe(false);
    } finally {
      await db.close();
    }
  });

  it("does not create a key file for :memory: databases by default", async () => {
    const db = openTestSqliteDb();
    try {
      await createDbSecretProvider({
        db,
        dbPath: ":memory:",
        tyrumHome,
        tenantId: DEFAULT_TENANT_ID,
      });
      expect(existsSync(join(tyrumHome, "master.key"))).toBe(false);
    } finally {
      await db.close();
    }
  });

  it("supports a shared key provider without creating local master.key state", async () => {
    const db = openTestSqliteDb(dbPath);
    const previous = process.env[SHARED_MASTER_KEY_ENV_VAR];
    process.env[SHARED_MASTER_KEY_ENV_VAR] = Buffer.alloc(32, 7).toString("base64");

    try {
      const factory = await createDbSecretProviderFactory({
        db,
        dbPath,
        tyrumHome,
        keyProvider: createSharedSecretKeyProvider(),
      });

      expect(factory.keyId).toHaveLength(16);
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
