import { afterEach, describe, expect, it } from "vitest";
import { DedupeDal } from "../../src/modules/connector/dedupe-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("DedupeDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createDal(): DedupeDal {
    db = openTestSqliteDb();
    return new DedupeDal(db);
  }

  it("isDuplicate returns false for new messages", async () => {
    const dal = createDal();
    const result = await dal.isDuplicate("msg-1", "telegram");
    expect(result).toBe(false);
  });

  it("isDuplicate returns true for seen messages", async () => {
    const dal = createDal();
    await dal.record("msg-1", "telegram", 3_600_000);
    const result = await dal.isDuplicate("msg-1", "telegram");
    expect(result).toBe(true);
  });

  it("isDuplicate returns false for same message_id on different channel", async () => {
    const dal = createDal();
    await dal.record("msg-1", "telegram", 3_600_000);
    const result = await dal.isDuplicate("msg-1", "discord");
    expect(result).toBe(false);
  });

  it("record is idempotent (INSERT OR IGNORE)", async () => {
    const dal = createDal();
    await dal.record("msg-1", "telegram", 3_600_000);
    // Should not throw on duplicate insert
    await dal.record("msg-1", "telegram", 3_600_000);
    const result = await dal.isDuplicate("msg-1", "telegram");
    expect(result).toBe(true);
  });

  it("cleanup removes expired records", async () => {
    const dal = createDal();
    // Record with TTL of 0 ms (already expired)
    await dal.record("msg-expired", "telegram", 0);
    // Record with long TTL (not expired)
    await dal.record("msg-fresh", "telegram", 3_600_000);

    // Small delay so the expired record's expires_at is in the past
    await new Promise((r) => setTimeout(r, 10));

    const removed = await dal.cleanup();
    expect(removed).toBe(1);

    // Expired record should be gone
    expect(await dal.isDuplicate("msg-expired", "telegram")).toBe(false);
    // Fresh record should remain
    expect(await dal.isDuplicate("msg-fresh", "telegram")).toBe(true);
  });

  it("cleanup returns 0 when nothing to clean", async () => {
    const dal = createDal();
    await dal.record("msg-1", "telegram", 3_600_000);
    const removed = await dal.cleanup();
    expect(removed).toBe(0);
  });
});
