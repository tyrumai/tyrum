import { afterEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { migrate } from "../../src/migrate.js";
import { SessionDal, formatSessionId } from "../../src/modules/agent/session-dal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations");

describe("SessionDal", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  function createDal(): SessionDal {
    db = new Database(":memory:");
    migrate(db, migrationsDir);
    return new SessionDal(db);
  }

  it("creates and retrieves sessions by channel/thread", () => {
    const dal = createDal();
    const first = dal.getOrCreate("telegram", "dm-1");
    const second = dal.getOrCreate("telegram", "dm-1");

    expect(first.session_id).toBe("telegram:dm-1");
    expect(second.session_id).toBe(first.session_id);
    expect(second.turns).toEqual([]);
  });

  it("stores bounded turn history", () => {
    const dal = createDal();
    const session = dal.getOrCreate("discord", "thread-42");

    dal.appendTurn(session.session_id, "u1", "a1", 2, "2026-02-17T00:00:00.000Z");
    dal.appendTurn(session.session_id, "u2", "a2", 2, "2026-02-17T00:01:00.000Z");
    const updated = dal.appendTurn(
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

  it("deletes expired sessions using ttl days", () => {
    const dal = createDal();
    const session = dal.getOrCreate("mattermost", "ops");
    db!
      .prepare(
        "UPDATE sessions SET updated_at = datetime('now', '-40 days') WHERE session_id = ?",
      )
      .run(session.session_id);

    const removed = dal.deleteExpired(30);
    const row = dal.getById(session.session_id);

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
