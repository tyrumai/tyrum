import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(first.agent_id).toBe("default");
    expect(second.session_id).toBe(first.session_id);
    expect(second.turns).toEqual([]);
  });

  it("isolates sessions per agent", async () => {
    const dal = createDal();
    const a = await dal.getOrCreate("telegram", "dm-1", "agent-1");
    const b = await dal.getOrCreate("telegram", "dm-1", "agent-2");
    const def = await dal.getOrCreate("telegram", "dm-1");

    expect(a.agent_id).toBe("agent-1");
    expect(b.agent_id).toBe("agent-2");
    expect(def.agent_id).toBe("default");

    expect(a.session_id).toBe("agent:agent-1:telegram:dm-1");
    expect(b.session_id).toBe("agent:agent-2:telegram:dm-1");
    expect(def.session_id).toBe("telegram:dm-1");
  });

  it("stores bounded turn history", async () => {
    const dal = createDal();
    const session = await dal.getOrCreate("discord", "thread-42");

    await dal.appendTurn(session.session_id, "u1", "a1", 2, "2026-02-17T00:00:00.000Z");
    await dal.appendTurn(session.session_id, "u2", "a2", 2, "2026-02-17T00:01:00.000Z");
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

  it("compacts overflow into session summary deterministically", async () => {
    const dal = createDal();
    const session = await dal.getOrCreate("discord", "thread-compact");

    const first = await dal.appendTurn(
      session.session_id,
      "u1",
      "a1",
      1,
      "2026-02-17T00:00:00.000Z",
    );
    expect(first.turns).toHaveLength(2);
    expect(first.summary).toBe("");

    const second = await dal.appendTurn(
      session.session_id,
      "u2",
      "a2",
      1,
      "2026-02-17T00:01:00.000Z",
    );
    expect(second.turns).toHaveLength(2);
    expect(second.turns[0]?.content).toBe("u2");
    expect(second.turns[1]?.content).toBe("a2");
    expect(second.summary).toContain("u1");
    expect(second.summary).toContain("a1");
    expect(second.summary).not.toContain("u2");

    const third = await dal.appendTurn(
      session.session_id,
      "u3",
      "a3",
      1,
      "2026-02-17T00:02:00.000Z",
    );
    expect(third.turns).toHaveLength(2);
    expect(third.turns[0]?.content).toBe("u3");
    expect(third.turns[1]?.content).toBe("a3");
    expect(third.summary).toContain("u1");
    expect(third.summary).toContain("u2");
    expect(third.summary).not.toContain("u3");
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

  it("deletes expired sessions across agents when agent id is omitted", async () => {
    const dal = createDal();
    const a = await dal.getOrCreate("mattermost", "ops", "agent-1");
    const b = await dal.getOrCreate("mattermost", "ops", "agent-2");

    await db!.run(
      "UPDATE sessions SET updated_at = datetime('now', '-40 days') WHERE session_id IN (?, ?)",
      [a.session_id, b.session_id],
    );

    const removed = await dal.deleteExpired(30);

    expect(removed).toBe(2);
    expect(await dal.getById(a.session_id, "agent-1")).toBeUndefined();
    expect(await dal.getById(b.session_id, "agent-2")).toBeUndefined();
  });

  it("deletes expired sessions only for the specified agent", async () => {
    const dal = createDal();
    const a = await dal.getOrCreate("mattermost", "ops", "agent-1");
    const b = await dal.getOrCreate("mattermost", "ops", "agent-2");

    await db!.run(
      "UPDATE sessions SET updated_at = datetime('now', '-40 days') WHERE session_id IN (?, ?)",
      [a.session_id, b.session_id],
    );

    const removed = await dal.deleteExpired(30, "agent-1");

    expect(removed).toBe(1);
    expect(await dal.getById(a.session_id, "agent-1")).toBeUndefined();
    expect(await dal.getById(b.session_id, "agent-2")).toBeDefined();
  });

  it("keeps newer legacy-format timestamps on threshold date", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-20T12:00:00.000Z"));

      const dal = createDal();
      const stale = await dal.getOrCreate("mattermost", "stale");
      const fresh = await dal.getOrCreate("mattermost", "fresh");

      await db!.run("UPDATE sessions SET updated_at = ? WHERE session_id = ?", [
        "2026-01-21 11:59:59",
        stale.session_id,
      ]);
      await db!.run("UPDATE sessions SET updated_at = ? WHERE session_id = ?", [
        "2026-01-21 13:00:00",
        fresh.session_id,
      ]);

      const removed = await dal.deleteExpired(30);
      const staleRow = await dal.getById(stale.session_id);
      const freshRow = await dal.getById(fresh.session_id);

      expect(removed).toBe(1);
      expect(staleRow).toBeUndefined();
      expect(freshRow).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists sessions by agent/channel ordered by updated_at desc with cursor pagination", async () => {
    const dal = createDal();

    const nowIso = new Date().toISOString();
    const t1 = "2026-02-17T00:00:00.000Z";
    const t2 = "2026-02-17T00:01:00.000Z";
    const t3 = "2026-02-17T00:02:00.000Z";

    const s1 = await dal.getOrCreate("ui", "thread-1");
    const s2 = await dal.getOrCreate("ui", "thread-2");
    const s3 = await dal.getOrCreate("ui", "thread-3");

    await dal.appendTurn(s3.session_id, "hello", "world", 20, "2026-02-17T00:00:30.000Z");

    // Ensure deterministic ordering independent of creation time.
    await db!.run("UPDATE sessions SET updated_at = ? WHERE agent_id = ? AND session_id = ?", [
      t1,
      "default",
      s1.session_id,
    ]);
    await db!.run("UPDATE sessions SET updated_at = ? WHERE agent_id = ? AND session_id = ?", [
      t2,
      "default",
      s2.session_id,
    ]);
    await db!.run("UPDATE sessions SET updated_at = ? WHERE agent_id = ? AND session_id = ?", [
      t3,
      "default",
      s3.session_id,
    ]);

    // Different channel should be excluded.
    await dal.getOrCreate("telegram", "dm-1");

    // Same updated_at: uses session_id tie-breaker.
    await db!.run("UPDATE sessions SET updated_at = ? WHERE agent_id = ? AND session_id = ?", [
      nowIso,
      "default",
      s2.session_id,
    ]);
    await db!.run("UPDATE sessions SET updated_at = ? WHERE agent_id = ? AND session_id = ?", [
      nowIso,
      "default",
      s3.session_id,
    ]);

    const page1 = await dal.list({ agentId: "default", channel: "ui", limit: 2 });
    expect(page1.sessions).toHaveLength(2);
    expect(page1.nextCursor).toBeTypeOf("string");
    const decodedCursor = JSON.parse(
      Buffer.from(page1.nextCursor as string, "base64url").toString("utf-8"),
    ) as Record<string, unknown>;
    expect(Object.keys(decodedCursor).sort()).toEqual(["session_id", "updated_at"]);
    expect(page1.sessions.map((s) => s.session_id)).toEqual([s3.session_id, s2.session_id]);
    expect(page1.sessions[0]?.turns_count).toBe(2);
    expect(page1.sessions[0]?.last_turn).toEqual({ role: "assistant", content: "world" });
    expect(page1.sessions[1]?.turns_count).toBe(0);
    expect(page1.sessions[1]?.last_turn).toBeNull();

    const page2 = await dal.list({
      agentId: "default",
      channel: "ui",
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.sessions.map((s) => s.session_id)).toEqual([s1.session_id]);
    expect(page2.nextCursor).toBeNull();
  });

  it("rejects invalid list cursors", async () => {
    const dal = createDal();
    await expect(
      dal.list({ agentId: "default", channel: "ui", cursor: "not-a-cursor" }),
    ).rejects.toThrow("invalid cursor");
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
