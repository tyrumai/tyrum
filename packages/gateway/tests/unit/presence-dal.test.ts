import { describe, expect, it, afterEach } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { PresenceDal } from "../../src/modules/presence/dal.js";

describe("PresenceDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    if (db) { await db.close(); db = undefined; }
  });

  it("upsert creates a new entry", async () => {
    db = openTestSqliteDb();
    const dal = new PresenceDal(db);
    const entry = await dal.upsert({ clientId: "client-1", capabilities: ["playwright"] });
    expect(entry.client_id).toBe("client-1");
    expect(entry.role).toBe("client");
    expect(entry.capabilities).toEqual(["playwright"]);
  });

  it("upsert updates last_seen_at on conflict", async () => {
    db = openTestSqliteDb();
    const dal = new PresenceDal(db);
    const first = await dal.upsert({ clientId: "client-1" });
    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));
    const second = await dal.upsert({ clientId: "client-1", capabilities: ["cli"] });
    expect(second.capabilities).toEqual(["cli"]);
  });

  it("remove deletes an entry", async () => {
    db = openTestSqliteDb();
    const dal = new PresenceDal(db);
    await dal.upsert({ clientId: "client-1" });
    const removed = await dal.remove("client-1");
    expect(removed).toBe(true);
    const entries = await dal.listActive();
    expect(entries).toHaveLength(0);
  });

  it("remove returns false for non-existent client", async () => {
    db = openTestSqliteDb();
    const dal = new PresenceDal(db);
    const removed = await dal.remove("does-not-exist");
    expect(removed).toBe(false);
  });

  it("listActive returns all entries", async () => {
    db = openTestSqliteDb();
    const dal = new PresenceDal(db);
    await dal.upsert({ clientId: "c1" });
    await dal.upsert({ clientId: "c2", role: "node", nodeId: "node-1" });
    const entries = await dal.listActive();
    expect(entries).toHaveLength(2);
  });

  it("cleanup removes stale entries", async () => {
    db = openTestSqliteDb();
    const dal = new PresenceDal(db);
    await dal.upsert({ clientId: "old-client" });
    // Set last_seen_at to the past
    await db.run(
      "UPDATE presence_entries SET last_seen_at = ? WHERE client_id = ?",
      [new Date(Date.now() - 60_000).toISOString(), "old-client"],
    );
    await dal.upsert({ clientId: "new-client" });
    const removed = await dal.cleanup(30_000); // 30s TTL
    expect(removed).toBe(1);
    const entries = await dal.listActive();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.client_id).toBe("new-client");
  });
});
