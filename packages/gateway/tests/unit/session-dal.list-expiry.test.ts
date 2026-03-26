import { afterEach, describe, expect, it, vi } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  appendTranscriptTurn,
  createSessionDalFixture,
  setSessionUpdatedAt,
} from "./session-dal.test-support.js";

describe("SessionDal expiry and listing", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createDal() {
    const fixture = createSessionDalFixture();
    db = fixture.db;
    return fixture.dal;
  }

  it("deletes expired sessions using ttl days", async () => {
    const dal = createDal();
    const session = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "ops",
      containerKind: "group",
    });
    await setSessionUpdatedAt({
      db: db!,
      tenantId: session.tenant_id,
      sessionIds: [session.session_id],
      valueSql: "datetime('now', '-40 days')",
    });

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

    await setSessionUpdatedAt({
      db: db!,
      tenantId: a.tenant_id,
      sessionIds: [a.session_id, b.session_id],
      valueSql: "datetime('now', '-40 days')",
    });

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

    await setSessionUpdatedAt({
      db: db!,
      tenantId: a.tenant_id,
      sessionIds: [a.session_id, b.session_id],
      valueSql: "datetime('now', '-40 days')",
    });

    const removed = await dal.deleteExpired(30, "agent-1");

    expect(removed).toBe(1);
    expect(await dal.getById({ tenantId: a.tenant_id, sessionId: a.session_id })).toBeUndefined();
    expect(await dal.getById({ tenantId: b.tenant_id, sessionId: b.session_id })).toBeDefined();
  });

  it("does not create a missing agent when deleting expired sessions by agent key", async () => {
    const dal = createDal();
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const before = await db!.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );

    const removed = await dal.deleteExpired(30, "missing-agent");

    const after = await db!.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );
    expect(removed).toBe(0);
    expect(after?.count ?? 0).toBe(before?.count ?? 0);
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

      await db!.run(
        "UPDATE conversations SET updated_at = ? WHERE tenant_id = ? AND conversation_id = ?",
        ["2026-01-21 11:59:59", stale.tenant_id, stale.session_id],
      );
      await db!.run(
        "UPDATE conversations SET updated_at = ? WHERE tenant_id = ? AND conversation_id = ?",
        ["2026-01-21 13:00:00", fresh.tenant_id, fresh.session_id],
      );

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

    const s1 = await dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "group",
    });
    const s2 = await dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-2",
      containerKind: "group",
    });
    const s3 = await dal.getOrCreate({
      connectorKey: "ui",
      providerThreadId: "thread-3",
      containerKind: "group",
    });

    await appendTranscriptTurn({
      dal,
      tenantId: s3.tenant_id,
      sessionId: s3.session_id,
      userMessage: "hello",
      assistantMessage: "world",
      timestamp: "2026-02-17T00:00:30.000Z",
    });

    await db!.run(
      "UPDATE conversations SET updated_at = ? WHERE tenant_id = ? AND conversation_id = ?",
      ["2026-02-17T00:00:00.000Z", s1.tenant_id, s1.session_id],
    );
    await db!.run(
      "UPDATE conversations SET updated_at = ? WHERE tenant_id = ? AND conversation_id = ?",
      ["2026-02-17T00:01:00.000Z", s2.tenant_id, s2.session_id],
    );
    await db!.run(
      "UPDATE conversations SET updated_at = ? WHERE tenant_id = ? AND conversation_id = ?",
      ["2026-02-17T00:02:00.000Z", s3.tenant_id, s3.session_id],
    );

    await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "dm-1",
      containerKind: "dm",
    });

    const page1 = await dal.list({ connectorKey: "ui", limit: 2 });
    expect(page1.sessions).toHaveLength(2);
    expect(page1.nextCursor).toBeTypeOf("string");
    const decodedCursor = JSON.parse(
      Buffer.from(page1.nextCursor as string, "base64url").toString("utf-8"),
    ) as Record<string, unknown>;
    expect(Object.keys(decodedCursor).toSorted()).toEqual(["session_id", "updated_at"]);
    expect(page1.sessions.map((session) => session.session_id)).toEqual([
      s3.session_id,
      s2.session_id,
    ]);
    expect(page1.sessions[0]?.title).toBe("");
    expect(page1.sessions[1]?.title).toBe("");
    expect(page1.sessions[0]?.transcript_count).toBe(2);
    expect(page1.sessions[0]?.last_text).toEqual({ role: "assistant", content: "world" });
    expect(page1.sessions[1]?.transcript_count).toBe(0);
    expect(page1.sessions[1]?.last_text).toBeNull();

    const page2 = await dal.list({
      connectorKey: "ui",
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.sessions.map((session) => session.session_id)).toEqual([s1.session_id]);
    expect(page2.nextCursor).toBeNull();
  });

  it("rejects invalid list cursors", async () => {
    const dal = createDal();
    await expect(dal.list({ connectorKey: "ui", cursor: "not-a-cursor" })).rejects.toThrow(
      "invalid cursor",
    );
  });
});
