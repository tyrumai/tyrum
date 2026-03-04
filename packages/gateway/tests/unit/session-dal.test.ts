import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";

describe("SessionDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createDal(): SessionDal {
    db = openTestSqliteDb();
    const identityScopeDal = new IdentityScopeDal(db, { cacheTtlMs: 60_000 });
    const channelThreadDal = new ChannelThreadDal(db);
    return new SessionDal(db, identityScopeDal, channelThreadDal);
  }

  it("creates and retrieves sessions by channel/thread", async () => {
    const dal = createDal();
    const first = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "dm-1",
      containerKind: "dm",
    });
    const second = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "dm-1",
      containerKind: "dm",
    });

    expect(first.session_key).toBe("agent:default:telegram:default:dm:dm-1");
    expect(first.session_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(second.session_id).toBe(first.session_id);
    expect(second.turns).toEqual([]);
  });

  it("isolates sessions per agent", async () => {
    const dal = createDal();
    const a = await dal.getOrCreate({
      scopeKeys: { agentKey: "agent-1" },
      connectorKey: "telegram",
      providerThreadId: "dm-1",
      containerKind: "dm",
    });
    const b = await dal.getOrCreate({
      scopeKeys: { agentKey: "agent-2" },
      connectorKey: "telegram",
      providerThreadId: "dm-1",
      containerKind: "dm",
    });
    const def = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "dm-1",
      containerKind: "dm",
    });

    expect(a.agent_id).not.toBe(b.agent_id);
    expect(def.agent_id).not.toBe(a.agent_id);
    expect(a.session_key).toContain("agent:agent-1:");
    expect(b.session_key).toContain("agent:agent-2:");
    expect(def.session_key).toContain("agent:default:");

    expect(a.session_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(b.session_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(def.session_id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("stores bounded turn history", async () => {
    const dal = createDal();
    const session = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "thread-42",
      containerKind: "group",
    });

    await dal.appendTurn({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      userMessage: "u1",
      assistantMessage: "a1",
      maxTurns: 2,
      timestamp: "2026-02-17T00:00:00.000Z",
    });
    await dal.appendTurn({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      userMessage: "u2",
      assistantMessage: "a2",
      maxTurns: 2,
      timestamp: "2026-02-17T00:01:00.000Z",
    });
    const updated = await dal.appendTurn({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      userMessage: "u3",
      assistantMessage: "a3",
      maxTurns: 2,
      timestamp: "2026-02-17T00:02:00.000Z",
    });

    expect(updated.turns).toHaveLength(4);
    expect(updated.turns[0]?.content).toBe("u2");
    expect(updated.turns[3]?.content).toBe("a3");
  });

  it("compacts overflow into session summary deterministically", async () => {
    const dal = createDal();
    const session = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "thread-compact",
      containerKind: "group",
    });

    const first = await dal.appendTurn({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      userMessage: "u1",
      assistantMessage: "a1",
      maxTurns: 1,
      timestamp: "2026-02-17T00:00:00.000Z",
    });
    expect(first.turns).toHaveLength(2);
    expect(first.summary).toBe("");

    const second = await dal.appendTurn({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      userMessage: "u2",
      assistantMessage: "a2",
      maxTurns: 1,
      timestamp: "2026-02-17T00:01:00.000Z",
    });
    expect(second.turns).toHaveLength(2);
    expect(second.turns[0]?.content).toBe("u2");
    expect(second.turns[1]?.content).toBe("a2");
    expect(second.summary).toContain("u1");
    expect(second.summary).toContain("a1");
    expect(second.summary).not.toContain("u2");

    const third = await dal.appendTurn({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      userMessage: "u3",
      assistantMessage: "a3",
      maxTurns: 1,
      timestamp: "2026-02-17T00:02:00.000Z",
    });
    expect(third.turns).toHaveLength(2);
    expect(third.turns[0]?.content).toBe("u3");
    expect(third.turns[1]?.content).toBe("a3");
    expect(third.summary).toContain("u1");
    expect(third.summary).toContain("u2");
    expect(third.summary).not.toContain("u3");
  });

  it("deletes expired sessions using ttl days", async () => {
    const dal = createDal();
    const session = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "ops",
      containerKind: "group",
    });
    await db!.run(
      "UPDATE sessions SET updated_at = datetime('now', '-40 days') WHERE tenant_id = ? AND session_id = ?",
      [session.tenant_id, session.session_id],
    );

    const removed = await dal.deleteExpired(30);
    const row = await dal.getById({ tenantId: session.tenant_id, sessionId: session.session_id });

    expect(removed).toBe(1);
    expect(row).toBeUndefined();
  });

  it("deletes expired sessions across agents when agent id is omitted", async () => {
    const dal = createDal();
    const a = await dal.getOrCreate({
      scopeKeys: { agentKey: "agent-1" },
      connectorKey: "telegram",
      providerThreadId: "ops",
      containerKind: "group",
    });
    const b = await dal.getOrCreate({
      scopeKeys: { agentKey: "agent-2" },
      connectorKey: "telegram",
      providerThreadId: "ops",
      containerKind: "group",
    });

    await db!.run(
      "UPDATE sessions SET updated_at = datetime('now', '-40 days') WHERE tenant_id = ? AND session_id IN (?, ?)",
      [a.tenant_id, a.session_id, b.session_id],
    );

    const removed = await dal.deleteExpired(30);

    expect(removed).toBe(2);
    expect(await dal.getById({ tenantId: a.tenant_id, sessionId: a.session_id })).toBeUndefined();
    expect(await dal.getById({ tenantId: b.tenant_id, sessionId: b.session_id })).toBeUndefined();
  });

  it("deletes expired sessions only for the specified agent", async () => {
    const dal = createDal();
    const a = await dal.getOrCreate({
      scopeKeys: { agentKey: "agent-1" },
      connectorKey: "telegram",
      providerThreadId: "ops",
      containerKind: "group",
    });
    const b = await dal.getOrCreate({
      scopeKeys: { agentKey: "agent-2" },
      connectorKey: "telegram",
      providerThreadId: "ops",
      containerKind: "group",
    });

    await db!.run(
      "UPDATE sessions SET updated_at = datetime('now', '-40 days') WHERE tenant_id = ? AND session_id IN (?, ?)",
      [a.tenant_id, a.session_id, b.session_id],
    );

    const removed = await dal.deleteExpired(30, "agent-1");

    expect(removed).toBe(1);
    expect(await dal.getById({ tenantId: a.tenant_id, sessionId: a.session_id })).toBeUndefined();
    expect(await dal.getById({ tenantId: b.tenant_id, sessionId: b.session_id })).toBeDefined();
  });

  it("keeps newer legacy-format timestamps on threshold date", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-20T12:00:00.000Z"));

      const dal = createDal();
      const stale = await dal.getOrCreate({
        connectorKey: "telegram",
        providerThreadId: "stale",
        containerKind: "group",
      });
      const fresh = await dal.getOrCreate({
        connectorKey: "telegram",
        providerThreadId: "fresh",
        containerKind: "group",
      });

      await db!.run("UPDATE sessions SET updated_at = ? WHERE tenant_id = ? AND session_id = ?", [
        "2026-01-21 11:59:59",
        stale.tenant_id,
        stale.session_id,
      ]);
      await db!.run("UPDATE sessions SET updated_at = ? WHERE tenant_id = ? AND session_id = ?", [
        "2026-01-21 13:00:00",
        fresh.tenant_id,
        fresh.session_id,
      ]);

      const removed = await dal.deleteExpired(30);
      const staleRow = await dal.getById({
        tenantId: stale.tenant_id,
        sessionId: stale.session_id,
      });
      const freshRow = await dal.getById({
        tenantId: fresh.tenant_id,
        sessionId: fresh.session_id,
      });

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
