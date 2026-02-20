import { afterEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { createDatabase } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { ConnectionDirectoryDal } from "../../src/modules/backplane/connection-directory.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("ConnectionDirectoryDal", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  function setup(): ConnectionDirectoryDal {
    db = createDatabase(":memory:");
    migrate(db, migrationsDir);
    return new ConnectionDirectoryDal(db);
  }

  it("upserts, filters by capability, and expires connections", () => {
    const dir = setup();
    const now = 1_000_000;

    dir.upsertConnection({
      connectionId: "c1",
      edgeId: "edge-a",
      capabilities: ["playwright"],
      nowMs: now,
      ttlMs: 5_000,
    });

    expect(dir.listConnectionsForCapability("playwright", now)).toHaveLength(1);
    expect(dir.listConnectionsForCapability("cli", now)).toHaveLength(0);

    // Expire it
    expect(dir.cleanupExpired(now + 10_000)).toBe(1);
    expect(dir.listConnectionsForCapability("playwright", now + 10_000)).toHaveLength(0);
  });
});

