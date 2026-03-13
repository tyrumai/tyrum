import { describe, expect, it, vi } from "vitest";
import { createChatStore } from "../src/stores/chat-store.js";

function sampleGetSession(sessionId: string) {
  return {
    session_id: sessionId,
    agent_id: "default",
    channel: "ui",
    thread_id: `ui-${sessionId}`,
    title: "",
    summary: "",
    transcript: [
      {
        kind: "text",
        id: `${sessionId}-user-1`,
        role: "user",
        content: "hello",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    updated_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
  } as const;
}

function createFakeWs() {
  const handlers = new Map<string, Array<(data: unknown) => void>>();
  return {
    sessionList: vi.fn(async () => ({ sessions: [], next_cursor: null })),
    sessionGet: vi.fn(async () => ({ session: sampleGetSession("session-1") })),
    sessionCreate: vi.fn(async () => ({
      session_id: "session-1",
      agent_id: "default",
      channel: "ui",
      thread_id: "ui-session-1",
      title: "",
    })),
    sessionCompact: vi.fn(async () => ({
      session_id: "session-1",
      dropped_messages: 0,
      kept_messages: 0,
    })),
    sessionDelete: vi.fn(async () => ({ session_id: "session-1" })),
    sessionSend: vi.fn(async () => ({ session_id: "session-1", assistant_message: "" })),
    on: vi.fn((event: string, handler: (data: unknown) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    off: vi.fn(),
    emit: (event: string, data: unknown) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(data);
      }
    },
  };
}

function createFakeHttp() {
  return {
    agentList: {
      get: vi.fn(async () => ({
        agents: [
          {
            agent_key: "default",
            persona: {
              name: "Default",
              description: "Default agent",
              tone: "direct",
              palette: "graphite",
              character: "operator",
            },
          },
        ],
      })),
    },
  };
}

describe("chatStore approval and order regressions", () => {
  it("hydrates approval updates immediately and merges later approval events without duplicates", async () => {
    const ws = createFakeWs();
    ws.sessionGet.mockResolvedValue({ session: sampleGetSession("session-1") });
    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.openSession("session-1");

    ws.emit("approval.updated", {
      occurred_at: "2026-01-01T00:00:02.000Z",
      payload: {
        approval: {
          approval_id: "11111111-1111-1111-1111-111111111111",
          approval_key: "approval:11111111-1111-1111-1111-111111111111",
          kind: "policy",
          status: "reviewing",
          prompt: "Allow tool?",
          motivation: "Allow tool?",
          created_at: "2026-01-01T00:00:02.000Z",
          expires_at: null,
          latest_review: {
            review_id: "review-1",
            target_type: "approval",
            target_id: "11111111-1111-1111-1111-111111111111",
            reviewer_kind: "guardian",
            reviewer_id: "guardian-1",
            state: "running",
            reason: "Guardian is reviewing the request.",
            risk_level: null,
            risk_score: null,
            evidence: null,
            decision_payload: null,
            created_at: "2026-01-01T00:00:02.000Z",
            started_at: "2026-01-01T00:00:02.000Z",
            completed_at: null,
          },
          context: {
            session_id: "session-1",
            thread_id: "ui-session-1",
            tool_call_id: "tool-1",
          },
        },
      },
    });

    expect(chat.getSnapshot().active.session?.transcript).toContainEqual({
      kind: "approval",
      id: "11111111-1111-1111-1111-111111111111",
      approval_id: "11111111-1111-1111-1111-111111111111",
      tool_call_id: "tool-1",
      status: "reviewing",
      title: "Approval required",
      detail: "Allow tool?",
      created_at: "2026-01-01T00:00:02.000Z",
      updated_at: "2026-01-01T00:00:02.000Z",
    });

    ws.emit("approval.updated", {
      occurred_at: "2026-01-01T00:00:03.000Z",
      payload: {
        approval: {
          approval_id: "11111111-1111-1111-1111-111111111111",
          approval_key: "approval:11111111-1111-1111-1111-111111111111",
          kind: "policy",
          status: "awaiting_human",
          prompt: "Allow tool?",
          motivation: "Allow tool?",
          created_at: "2026-01-01T00:00:01.500Z",
          expires_at: null,
          latest_review: {
            review_id: "review-2",
            target_type: "approval",
            target_id: "11111111-1111-1111-1111-111111111111",
            reviewer_kind: "guardian",
            reviewer_id: "guardian-1",
            state: "requested_human",
            reason: "Guardian needs human review.",
            risk_level: "high",
            risk_score: 0.82,
            evidence: null,
            decision_payload: null,
            created_at: "2026-01-01T00:00:03.000Z",
            started_at: "2026-01-01T00:00:02.000Z",
            completed_at: "2026-01-01T00:00:03.000Z",
          },
          context: {
            session_id: "session-1",
            thread_id: "ui-session-1",
            tool_call_id: "tool-1",
          },
        },
      },
    });

    const approvals = chat
      .getSnapshot()
      .active.session?.transcript.filter(
        (item) => item.kind === "approval" && item.id === "11111111-1111-1111-1111-111111111111",
      );
    expect(approvals).toHaveLength(1);
    expect(approvals?.[0]).toMatchObject({
      created_at: "2026-01-01T00:00:01.500Z",
      updated_at: "2026-01-01T00:00:03.000Z",
      status: "awaiting_human",
    });
  });

  it("keeps tool bubbles in their original position when later lifecycle updates arrive", async () => {
    const ws = createFakeWs();
    ws.sessionGet.mockResolvedValue({ session: sampleGetSession("session-1") });
    const http = createFakeHttp();
    const chat = createChatStore(ws as any, http as any);

    await chat.openSession("session-1");

    ws.emit("tool.lifecycle", {
      occurred_at: "2026-01-01T00:00:01.000Z",
      payload: {
        session_id: "session-1",
        thread_id: "ui-session-1",
        tool_call_id: "tool-1",
        tool_id: "shell.exec",
        status: "running",
        summary: "Started",
      },
    });
    ws.emit("message.final", {
      occurred_at: "2026-01-01T00:00:02.000Z",
      payload: {
        session_id: "session-1",
        thread_id: "ui-session-1",
        message_id: "assistant-1",
        role: "assistant",
        content: "Finished",
      },
    });
    ws.emit("tool.lifecycle", {
      occurred_at: "2026-01-01T00:00:03.000Z",
      payload: {
        session_id: "session-1",
        thread_id: "ui-session-1",
        tool_call_id: "tool-1",
        tool_id: "shell.exec",
        status: "completed",
        summary: "Done",
      },
    });

    expect(chat.getSnapshot().active.session?.transcript).toEqual([
      {
        kind: "text",
        id: "session-1-user-1",
        role: "user",
        content: "hello",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        kind: "tool",
        id: "tool-1",
        tool_id: "shell.exec",
        tool_call_id: "tool-1",
        status: "completed",
        summary: "Done",
        created_at: "2026-01-01T00:00:01.000Z",
        updated_at: "2026-01-01T00:00:03.000Z",
        thread_id: "ui-session-1",
      },
      {
        kind: "text",
        id: "assistant-1",
        role: "assistant",
        content: "Finished",
        created_at: "2026-01-01T00:00:02.000Z",
      },
    ]);
  });
});
