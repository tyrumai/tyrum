import { afterEach, describe, expect, it } from "vitest";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { createSessionDalFixture } from "./session-dal.test-support.js";

describe("SessionDal transcript regressions", () => {
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

  it("preserves structured transcript items while compacting older text entries", async () => {
    const dal = createDal();
    const session = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "thread-compact-structured",
      containerKind: "group",
    });

    await dal.replaceTranscript({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      transcript: [
        {
          kind: "text",
          id: "turn-1",
          role: "user",
          content: "u1",
          created_at: "2026-03-08T00:00:00Z",
        },
        {
          kind: "tool",
          id: "tool-1",
          tool_id: "webfetch",
          tool_call_id: "call-1",
          status: "completed",
          summary: "Fetched page",
          created_at: "2026-03-08T00:00:00Z",
          updated_at: "2026-03-08T00:00:01Z",
          channel: "telegram",
          thread_id: "thread-compact-structured",
          agent_id: session.agent_id,
          workspace_id: session.workspace_id,
        },
        {
          kind: "text",
          id: "turn-2",
          role: "assistant",
          content: "a1",
          created_at: "2026-03-08T00:00:02Z",
        },
        {
          kind: "approval",
          id: "approval-1",
          approval_id: "approval-1",
          status: "pending",
          title: "Approval required",
          detail: "Need approval",
          created_at: "2026-03-08T00:00:03Z",
          updated_at: "2026-03-08T00:00:03Z",
        },
        {
          kind: "text",
          id: "turn-3",
          role: "user",
          content: "u2",
          created_at: "2026-03-08T00:00:04Z",
        },
      ],
      summary: "",
    });

    const compacted = await dal.compact({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      keepLastMessages: 2,
    });

    expect(compacted).toEqual({ droppedMessages: 1, keptMessages: 2 });

    const updated = await dal.getById({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
    });
    expect(updated?.transcript).toEqual([
      expect.objectContaining({ id: "tool-1", kind: "tool" }),
      expect.objectContaining({ id: "turn-2", kind: "text" }),
      expect.objectContaining({ id: "approval-1", kind: "approval" }),
      expect.objectContaining({ id: "turn-3", kind: "text" }),
    ]);
    expect(updated?.summary).toContain("u1");
    expect(updated?.summary).not.toContain("a1");
  });

  it("drops older structured items that fall outside the retained suffix", async () => {
    const dal = createDal();
    const session = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "thread-compact-bounded",
      containerKind: "group",
    });

    await dal.replaceTranscript({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      transcript: [
        {
          kind: "text",
          id: "turn-1",
          role: "user",
          content: "u1",
          created_at: "2026-03-08T00:00:00Z",
        },
        {
          kind: "tool",
          id: "tool-old",
          tool_id: "webfetch",
          tool_call_id: "call-old",
          status: "completed",
          summary: "Older fetch",
          created_at: "2026-03-08T00:00:00Z",
          updated_at: "2026-03-08T00:00:01Z",
          channel: "telegram",
          thread_id: "thread-compact-bounded",
          agent_id: session.agent_id,
          workspace_id: session.workspace_id,
        },
        {
          kind: "text",
          id: "turn-2",
          role: "assistant",
          content: "a1",
          created_at: "2026-03-08T00:00:02Z",
        },
        {
          kind: "tool",
          id: "tool-new",
          tool_id: "webfetch",
          tool_call_id: "call-new",
          status: "completed",
          summary: "Recent fetch",
          created_at: "2026-03-08T00:00:03Z",
          updated_at: "2026-03-08T00:00:04Z",
          channel: "telegram",
          thread_id: "thread-compact-bounded",
          agent_id: session.agent_id,
          workspace_id: session.workspace_id,
        },
        {
          kind: "text",
          id: "turn-3",
          role: "user",
          content: "u2",
          created_at: "2026-03-08T00:00:05Z",
        },
      ],
      summary: "",
    });

    const compacted = await dal.compact({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      keepLastMessages: 1,
    });

    expect(compacted).toEqual({ droppedMessages: 2, keptMessages: 1 });

    const updated = await dal.getById({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
    });
    expect(updated?.transcript).toEqual([
      expect.objectContaining({ id: "tool-new", kind: "tool" }),
      expect.objectContaining({ id: "turn-3", kind: "text" }),
    ]);
    expect(updated?.transcript.some((item) => item.id === "tool-old")).toBe(false);
  });

  it("preserves created_at when updating an existing tool transcript item", async () => {
    const dal = createDal();
    const session = await dal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "thread-tool-upsert",
      containerKind: "group",
    });

    await dal.upsertTranscriptItem({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      item: {
        kind: "tool",
        id: "tool-call-1",
        tool_id: "shell",
        tool_call_id: "tool-call-1",
        status: "running",
        summary: "Started",
        created_at: "2026-03-08T00:00:00Z",
        updated_at: "2026-03-08T00:00:01Z",
        channel: "telegram",
        thread_id: "thread-tool-upsert",
        agent_id: session.agent_id,
        workspace_id: session.workspace_id,
      },
    });

    await dal.upsertTranscriptItem({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      item: {
        kind: "tool",
        id: "tool-call-1",
        tool_id: "shell",
        tool_call_id: "tool-call-1",
        status: "completed",
        summary: "Finished",
        created_at: "2026-03-08T00:00:09Z",
        updated_at: "2026-03-08T00:00:10Z",
        channel: "telegram",
        thread_id: "thread-tool-upsert",
        agent_id: session.agent_id,
        workspace_id: session.workspace_id,
      },
    });

    const updated = await dal.getById({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
    });
    const toolItem = updated?.transcript.find(
      (item) => item.kind === "tool" && item.id === "tool-call-1",
    );

    expect(toolItem?.status).toBe("completed");
    expect(toolItem?.created_at).toBe("2026-03-08T00:00:00Z");
    expect(toolItem?.updated_at).toBe("2026-03-08T00:00:10Z");
    expect(toolItem?.summary).toBe("Finished");
  });
});
