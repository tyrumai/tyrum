import { describe, expect, it, afterEach } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { MemoryDal } from "../../src/modules/memory/dal.js";

describe("MemoryDal delete methods", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    if (db) { await db.close(); db = undefined; }
  });

  it("deleteFact removes existing fact", async () => {
    db = openTestSqliteDb();
    const dal = new MemoryDal(db);
    const id = await dal.insertFact("key", "value", "test", new Date().toISOString(), 0.9);
    const deleted = await dal.deleteFact(id);
    expect(deleted).toBe(true);
    const facts = await dal.getFacts();
    expect(facts).toHaveLength(0);
  });

  it("deleteFact returns false for non-existent id", async () => {
    db = openTestSqliteDb();
    const dal = new MemoryDal(db);
    const deleted = await dal.deleteFact(99999);
    expect(deleted).toBe(false);
  });

  it("deleteEpisodicEvent removes existing event", async () => {
    db = openTestSqliteDb();
    const dal = new MemoryDal(db);
    const id = await dal.insertEpisodicEvent("evt-1", new Date().toISOString(), "test", "test_type", { data: 1 });
    const deleted = await dal.deleteEpisodicEvent(id);
    expect(deleted).toBe(true);
    const events = await dal.getEpisodicEvents();
    expect(events).toHaveLength(0);
  });

  it("deleteCapabilityMemory removes existing memory", async () => {
    db = openTestSqliteDb();
    const dal = new MemoryDal(db);
    await dal.upsertCapabilityMemory("type", "id", "kind", {});
    // Get the ID from the database
    const rows = await dal.getCapabilityMemories();
    expect(rows.length).toBeGreaterThan(0);
    const deleted = await dal.deleteCapabilityMemory(rows[0]!.id);
    expect(deleted).toBe(true);
    const after = await dal.getCapabilityMemories();
    expect(after).toHaveLength(0);
  });
});
