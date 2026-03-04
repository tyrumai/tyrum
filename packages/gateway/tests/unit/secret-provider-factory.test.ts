import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { createDbSecretProvider } from "../../src/modules/secret/create-secret-provider.js";

describe("createDbSecretProvider", () => {
  let tempDir: string;
  let dbPath: string;
  let tyrumHome: string;
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = {
      TYRUM_SECRETS_MASTER_KEY_PATH: process.env["TYRUM_SECRETS_MASTER_KEY_PATH"],
    };
    delete process.env["TYRUM_SECRETS_MASTER_KEY_PATH"];

    tempDir = mkdtempSync(join(tmpdir(), "tyrum-secret-provider-factory-"));
    dbPath = join(tempDir, "gateway.db");
    tyrumHome = join(tempDir, "home");
  });

  afterEach(() => {
    if (envSnapshot.TYRUM_SECRETS_MASTER_KEY_PATH === undefined) {
      delete process.env["TYRUM_SECRETS_MASTER_KEY_PATH"];
    } else {
      process.env["TYRUM_SECRETS_MASTER_KEY_PATH"] = envSnapshot.TYRUM_SECRETS_MASTER_KEY_PATH;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("honors TYRUM_SECRETS_MASTER_KEY_PATH", async () => {
    const overridePath = join(tempDir, "override.master.key");
    process.env["TYRUM_SECRETS_MASTER_KEY_PATH"] = overridePath;

    const db = openTestSqliteDb(dbPath);
    try {
      await createDbSecretProvider({ db, dbPath, tyrumHome });
      expect(existsSync(overridePath)).toBe(true);
      expect(existsSync(`${dbPath}.secrets.key`)).toBe(false);
    } finally {
      await db.close();
    }
  });

  it("does not create a key file for :memory: databases by default", async () => {
    const db = openTestSqliteDb();
    try {
      await createDbSecretProvider({ db, dbPath: ":memory:", tyrumHome });
      expect(existsSync(join(tyrumHome, "secrets.master.key"))).toBe(false);
    } finally {
      await db.close();
    }
  });
});
