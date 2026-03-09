import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { ChannelOutboxDal } from "../../src/modules/channels/outbox-dal.js";
import { seedCompletedTelegramTurn } from "../helpers/channel-session-repair.js";
import { MetricsRegistry } from "../../src/modules/observability/metrics.js";

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
    expect(first.title).toBe("");
    expect(second.session_id).toBe(first.session_id);
    expect(second.title).toBe("");
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

  it("stores appended turn history without implicit compaction", async () => {
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
      timestamp: "2026-02-17T00:00:00.000Z",
    });
    await dal.appendTurn({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      userMessage: "u2",
      assistantMessage: "a2",
      timestamp: "2026-02-17T00:01:00.000Z",
    });
    const updated = await dal.appendTurn({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      userMessage: "u3",
      assistantMessage: "a3",
      timestamp: "2026-02-17T00:02:00.000Z",
    });

    expect(updated.turns).toHaveLength(6);
    expect(updated.title).toBe("");
    expect(updated.turns[0]?.content).toBe("u1");
    expect(updated.turns[5]?.content).toBe("a3");
  });

  it("compacts overflow into session summary deterministically when requested", async () => {
    const dal = createDal();
    const session = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "thread-compact",
      containerKind: "group",
    });

    await dal.appendTurn({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      userMessage: "u1",
      assistantMessage: "a1",
      timestamp: "2026-02-17T00:00:00.000Z",
    });
    await dal.appendTurn({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      userMessage: "u2",
      assistantMessage: "a2",
      timestamp: "2026-02-17T00:01:00.000Z",
    });
    await dal.appendTurn({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      userMessage: "u3",
      assistantMessage: "a3",
      timestamp: "2026-02-17T00:02:00.000Z",
    });

    const compacted = await dal.compact({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      keepLastMessages: 2,
    });
    expect(compacted).toEqual({ droppedMessages: 4, keptMessages: 2 });

    const updated = await dal.getById({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
    });
    expect(updated?.turns).toHaveLength(2);
    expect(updated?.turns[0]?.content).toBe("u3");
    expect(updated?.turns[1]?.content).toBe("a3");
    expect(updated?.summary).toContain("u1");
    expect(updated?.summary).toContain("u2");
    expect(updated?.summary).not.toContain("u3");
  });

  it("supports keeping zero recent messages during deterministic compaction", async () => {
    const dal = createDal();
    const session = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "thread-compact-zero",
      containerKind: "group",
    });

    await dal.appendTurn({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      userMessage: "u1",
      assistantMessage: "a1",
      timestamp: "2026-02-17T00:00:00.000Z",
    });

    const compacted = await dal.compact({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      keepLastMessages: 0,
    });

    expect(compacted).toEqual({ droppedMessages: 2, keptMessages: 0 });

    const updated = await dal.getById({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
    });
    expect(updated?.turns).toEqual([]);
    expect(updated?.title).toBe("");
    expect(updated?.summary).toContain("u1");
    expect(updated?.summary).toContain("a1");
  });

  it("flags malformed turns_json on direct reads while keeping the session usable", async () => {
    db = openTestSqliteDb();
    const logger = { warn: vi.fn() };
    const metrics = new MetricsRegistry();
    const identityScopeDal = new IdentityScopeDal(db, { cacheTtlMs: 60_000 });
    const channelThreadDal = new ChannelThreadDal(db);
    const dal = new SessionDal(db, identityScopeDal, channelThreadDal, { logger, metrics });

    const session = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "thread-corrupt",
      containerKind: "group",
    });

    await db.run("UPDATE sessions SET turns_json = ? WHERE tenant_id = ? AND session_id = ?", [
      "{ not: json",
      session.tenant_id,
      session.session_id,
    ]);

    const row = await dal.getById({ tenantId: session.tenant_id, sessionId: session.session_id });
    expect(row?.turns).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "persisted_json.read_failed",
      expect.objectContaining({
        table: "sessions",
        column: "turns_json",
        reason: "invalid_json",
      }),
    );

    const metricsText = await metrics.registry.getSingleMetricAsString(
      "persisted_json_read_failures_total",
    );
    expect(metricsText).toContain('table="sessions",column="turns_json",reason="invalid_json"');
  });

  it("sets a title only while the stored title is blank", async () => {
    const dal = createDal();
    const session = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "thread-title",
      containerKind: "group",
    });

    const setBlank = await dal.setTitleIfBlank({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      title: "  Investigate failing webhook retry  ",
    });
    expect(setBlank).toBe(true);

    const updated = await dal.getById({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
    });
    expect(updated?.title).toBe("Investigate failing webhook retry");

    const setAgain = await dal.setTitleIfBlank({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      title: "should not overwrite",
    });
    expect(setAgain).toBe(false);

    const unchanged = await dal.getById({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
    });
    expect(unchanged?.title).toBe("Investigate failing webhook retry");
  });

  it("repairs bounded session turns and summary from retained channel logs", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-17T00:10:00.000Z"));

      const dal = createDal();
      const session = await dal.getOrCreate({
        connectorKey: "telegram",
        providerThreadId: "thread-repair",
        containerKind: "channel",
      });
      const inboxDal = new ChannelInboxDal(db!, dal);
      const outboxDal = new ChannelOutboxDal(db!);

      await seedCompletedTelegramTurn({
        inboxDal,
        outboxDal,
        session,
        threadId: "thread-repair",
        messageId: "msg-1",
        userText: "u1",
        assistantText: "a1",
        receivedAtMs: Date.parse("2026-02-17T00:00:00.000Z"),
      });
      await seedCompletedTelegramTurn({
        inboxDal,
        outboxDal,
        session,
        threadId: "thread-repair",
        messageId: "msg-2",
        userText: "u2",
        assistantText: "a2",
        receivedAtMs: Date.parse("2026-02-17T00:01:00.000Z"),
      });

      await db!.run(
        `UPDATE sessions
         SET turns_json = ?, summary = ?, updated_at = ?
         WHERE tenant_id = ? AND session_id = ?`,
        [
          JSON.stringify([
            { role: "user", content: "stale", timestamp: "2026-02-17T00:00:00.000Z" },
          ]),
          "stale-summary",
          "2026-02-17T00:02:00.000Z",
          session.tenant_id,
          session.session_id,
        ],
      );

      const repaired = await dal.repairFromChannelLogs({
        tenantId: session.tenant_id,
        sessionId: session.session_id,
      });

      expect(repaired).toEqual({
        source_rows: 2,
        rebuilt_messages: 4,
        kept_messages: 4,
        dropped_messages: 0,
      });

      const updated = await dal.getById({
        tenantId: session.tenant_id,
        sessionId: session.session_id,
      });
      expect(updated?.title).toBe("");
      expect(updated?.summary).toBe("stale-summary");
      expect(updated?.turns).toEqual([
        { role: "user", content: "u1", timestamp: "2026-02-17T00:10:00.000Z" },
        { role: "assistant", content: "a1", timestamp: "2026-02-17T00:10:00.000Z" },
        { role: "user", content: "u2", timestamp: "2026-02-17T00:10:00.000Z" },
        { role: "assistant", content: "a2", timestamp: "2026-02-17T00:10:00.000Z" },
      ]);
    } finally {
      vi.useRealTimers();
    }
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

    const t1 = "2026-02-17T00:00:00.000Z";
    const t2 = "2026-02-17T00:01:00.000Z";
    const t3 = "2026-02-17T00:02:00.000Z";

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

    await dal.appendTurn({
      tenantId: s3.tenant_id,
      sessionId: s3.session_id,
      userMessage: "hello",
      assistantMessage: "world",
      timestamp: "2026-02-17T00:00:30.000Z",
    });

    // Ensure deterministic ordering independent of creation time.
    await db!.run("UPDATE sessions SET updated_at = ? WHERE tenant_id = ? AND session_id = ?", [
      t1,
      s1.tenant_id,
      s1.session_id,
    ]);
    await db!.run("UPDATE sessions SET updated_at = ? WHERE tenant_id = ? AND session_id = ?", [
      t2,
      s2.tenant_id,
      s2.session_id,
    ]);
    await db!.run("UPDATE sessions SET updated_at = ? WHERE tenant_id = ? AND session_id = ?", [
      t3,
      s3.tenant_id,
      s3.session_id,
    ]);

    // Different channel should be excluded.
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
    expect(page1.sessions.map((s) => s.session_id)).toEqual([s3.session_key, s2.session_key]);
    expect(page1.sessions[0]?.title).toBe("");
    expect(page1.sessions[1]?.title).toBe("");
    expect(page1.sessions[0]?.turns_count).toBe(2);
    expect(page1.sessions[0]?.last_turn).toEqual({ role: "assistant", content: "world" });
    expect(page1.sessions[1]?.turns_count).toBe(0);
    expect(page1.sessions[1]?.last_turn).toBeNull();

    const page2 = await dal.list({
      connectorKey: "ui",
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.sessions.map((s) => s.session_id)).toEqual([s1.session_key]);
    expect(page2.nextCursor).toBeNull();
  });

  it("rejects invalid list cursors", async () => {
    const dal = createDal();
    await expect(dal.list({ connectorKey: "ui", cursor: "not-a-cursor" })).rejects.toThrow(
      "invalid cursor",
    );
  });
});
