import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { MetricsRegistry } from "../../src/modules/observability/metrics.js";
import {
  appendThreeTranscriptTurns,
  appendTranscriptTurn,
  createObservedSessionDalFixture,
  createSessionDalFixture,
  seedRepairTurns,
  setSessionTranscriptAndSummary,
  textTranscript,
} from "./session-dal.test-support.js";

describe("SessionDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createDal(): SessionDal {
    const fixture = createSessionDalFixture();
    db = fixture.db;
    return fixture.dal;
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
    expect(second.transcript).toEqual([]);
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

    const updated = await appendThreeTranscriptTurns({
      dal,
      tenantId: session.tenant_id,
      sessionId: session.session_id,
    });

    const turns = textTranscript(updated);
    expect(turns).toHaveLength(6);
    expect(updated.title).toBe("");
    expect(turns[0]?.content).toBe("u1");
    expect(turns[5]?.content).toBe("a3");
  });

  it("compacts overflow into session summary deterministically when requested", async () => {
    const dal = createDal();
    const session = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "thread-compact",
      containerKind: "group",
    });

    await appendThreeTranscriptTurns({
      dal,
      tenantId: session.tenant_id,
      sessionId: session.session_id,
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
    const turns = textTranscript(updated ?? {});
    expect(turns).toHaveLength(2);
    expect(turns[0]?.content).toBe("u3");
    expect(turns[1]?.content).toBe("a3");
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

    await appendTranscriptTurn({
      dal,
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
    expect(updated?.transcript).toEqual([]);
    expect(updated?.title).toBe("");
    expect(updated?.summary).toContain("u1");
    expect(updated?.summary).toContain("a1");
  });

  it("flags malformed transcript_json on direct reads while keeping the session usable", async () => {
    const logger = { warn: vi.fn() };
    const metrics = new MetricsRegistry();
    const fixture = createObservedSessionDalFixture({ logger, metrics });
    db = fixture.db;
    const dal = fixture.dal;

    const session = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "thread-corrupt",
      containerKind: "group",
    });

    await db.run("UPDATE sessions SET transcript_json = ? WHERE tenant_id = ? AND session_id = ?", [
      "{ not: json",
      session.tenant_id,
      session.session_id,
    ]);

    const row = await dal.getById({ tenantId: session.tenant_id, sessionId: session.session_id });
    expect(row?.transcript).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "persisted_json.read_failed",
      expect.objectContaining({
        table: "sessions",
        column: "transcript_json",
        reason: "invalid_json",
      }),
    );

    const metricsText = await metrics.registry.getSingleMetricAsString(
      "persisted_json_read_failures_total",
    );
    expect(metricsText).toContain('table="sessions",column="transcript_json",reason="invalid_json"');
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
      await seedRepairTurns({
        db: db!,
        dal,
        session,
        threadId: "thread-repair",
        turns: [
          {
            messageId: "msg-1",
            userText: "u1",
            assistantText: "a1",
            receivedAtMs: Date.parse("2026-02-17T00:00:00.000Z"),
          },
          {
            messageId: "msg-2",
            userText: "u2",
            assistantText: "a2",
            receivedAtMs: Date.parse("2026-02-17T00:01:00.000Z"),
          },
        ],
      });

      await setSessionTranscriptAndSummary({
        db: db!,
        session,
        transcriptJson: JSON.stringify([
          { role: "user", content: "stale", timestamp: "2026-02-17T00:00:00.000Z" },
        ]),
        summary: "stale-summary",
        updatedAt: "2026-02-17T00:02:00.000Z",
      });

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
      expect(textTranscript(updated ?? {})).toEqual([
        expect.objectContaining({
          kind: "text",
          role: "user",
          content: "u1",
          created_at: "2026-02-17T00:10:00.000Z",
        }),
        expect.objectContaining({
          kind: "text",
          role: "assistant",
          content: "a1",
          created_at: "2026-02-17T00:10:00.000Z",
        }),
        expect.objectContaining({
          kind: "text",
          role: "user",
          content: "u2",
          created_at: "2026-02-17T00:10:00.000Z",
        }),
        expect.objectContaining({
          kind: "text",
          role: "assistant",
          content: "a2",
          created_at: "2026-02-17T00:10:00.000Z",
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

});
