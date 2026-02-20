import { afterEach, describe, expect, it } from "vitest";
import { SessionDal, formatSessionId } from "../../src/modules/agent/session-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("SessionDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createDal(): SessionDal {
    db = openTestSqliteDb();
    return new SessionDal(db);
  }

  it("creates and retrieves sessions by channel/thread", async () => {
    const dal = createDal();
    const first = await dal.getOrCreate("telegram", "dm-1");
    const second = await dal.getOrCreate("telegram", "dm-1");

    expect(first.session_id).toBe("telegram:dm-1");
    expect(second.session_id).toBe(first.session_id);
    expect(second.turns).toEqual([]);
  });

  it("stores bounded turn history", async () => {
    const dal = createDal();
    const session = await dal.getOrCreate("discord", "thread-42");

    await dal.appendTurn(
      session.session_id,
      "u1",
      "a1",
      2,
      "2026-02-17T00:00:00.000Z",
    );
    await dal.appendTurn(
      session.session_id,
      "u2",
      "a2",
      2,
      "2026-02-17T00:01:00.000Z",
    );
    const updated = await dal.appendTurn(
      session.session_id,
      "u3",
      "a3",
      2,
      "2026-02-17T00:02:00.000Z",
    );

    expect(updated.turns).toHaveLength(4);
    expect(updated.turns[0]?.content).toBe("u2");
    expect(updated.turns[3]?.content).toBe("a3");
  });

  it("deletes expired sessions using ttl days", async () => {
    const dal = createDal();
    const session = await dal.getOrCreate("mattermost", "ops");
    await db!.run(
      "UPDATE sessions SET updated_at = datetime('now', '-40 days') WHERE session_id = ?",
      [session.session_id],
    );

    const removed = await dal.deleteExpired(30);
    const row = await dal.getById(session.session_id);

    expect(removed).toBe(1);
    expect(row).toBeUndefined();
  });
});

describe("formatSessionId", () => {
  it("joins channel and thread id deterministically", () => {
    expect(formatSessionId("telegram", "123")).toBe("telegram:123");
  });

  it("escapes colons to avoid collisions", () => {
    expect(formatSessionId("a", "b:c")).toBe("a:b%3Ac");
    expect(formatSessionId("a:b", "c")).toBe("a%3Ab:c");
  });
});
