import { describe, expect, it, vi } from "vitest";
import type { WsSessionGetSession } from "@tyrum/client";
import type { SessionTranscriptItem } from "@tyrum/schemas";
import {
  activeToolCallIdsForSession,
  appendTranscriptReasoningDelta,
  appendTranscriptTextDelta,
  eventOccurredAt,
  mergeFetchedTranscript,
  readApprovalThreadId,
  readApprovalSessionId,
  sortTranscriptItems,
  toApprovalTranscriptItem,
  toReasoningTranscriptItem,
  toToolTranscriptItem,
  upsertTranscriptItem,
} from "../src/stores/chat-store.transcript.js";

function textItem(
  id: string,
  createdAt: string,
  content: string,
): Extract<SessionTranscriptItem, { kind: "text" }> {
  return {
    kind: "text",
    id,
    role: "user",
    content,
    created_at: createdAt,
  };
}

function toolItem(
  id: string,
  updatedAt: string,
  status: Extract<SessionTranscriptItem, { kind: "tool" }>["status"],
): Extract<SessionTranscriptItem, { kind: "tool" }> {
  return {
    kind: "tool",
    id,
    tool_id: `tool-${id}`,
    tool_call_id: `call-${id}`,
    status,
    summary: "",
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

function sessionWithTranscript(transcript: SessionTranscriptItem[]): WsSessionGetSession {
  return {
    session_id: "session-1",
    agent_id: "agent-1",
    channel: "ui",
    thread_id: "thread-1",
    title: "",
    summary: "",
    transcript,
    updated_at: "2026-03-09T00:00:00.000Z",
    created_at: "2026-03-09T00:00:00.000Z",
  };
}

describe("chat-store transcript helpers", () => {
  it("sorts transcript items by effective timestamp and id", () => {
    const sorted = sortTranscriptItems([
      toolItem("b", "2026-03-09T00:00:02.000Z", "running"),
      textItem("c", "2026-03-09T00:00:01.000Z", "later"),
      textItem("a", "2026-03-09T00:00:01.000Z", "first"),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  it("merges fetched transcript with local structured overlay items", () => {
    const merged = mergeFetchedTranscript(
      [
        textItem("old-text", "2026-03-09T00:00:01.000Z", "old"),
        toolItem("tool-local", "2026-03-09T00:00:03.000Z", "running"),
      ],
      [textItem("new-text", "2026-03-09T00:00:02.000Z", "new")],
    );

    expect(merged.map((item) => item.id)).toEqual(["new-text", "tool-local"]);
  });

  it("upserts transcript items and preserves sorted order", () => {
    const session = sessionWithTranscript([
      textItem("message-1", "2026-03-09T00:00:01.000Z", "hello"),
      toolItem("tool-1", "2026-03-09T00:00:02.000Z", "running"),
    ]);

    const updated = upsertTranscriptItem(session, {
      ...toolItem("tool-1", "2026-03-09T00:00:04.000Z", "completed"),
      summary: "done",
    });

    expect(updated.transcript).toHaveLength(2);
    expect(updated.transcript[1]).toMatchObject({
      id: "tool-1",
      status: "completed",
      summary: "done",
    });
  });

  it("tracks only active tool calls", () => {
    const session = sessionWithTranscript([
      toolItem("queued", "2026-03-09T00:00:01.000Z", "queued"),
      toolItem("running", "2026-03-09T00:00:02.000Z", "running"),
      toolItem("approval", "2026-03-09T00:00:03.000Z", "awaiting_approval"),
      toolItem("done", "2026-03-09T00:00:04.000Z", "completed"),
    ]);

    expect(activeToolCallIdsForSession(session)).toEqual([
      "call-queued",
      "call-running",
      "call-approval",
    ]);
    expect(activeToolCallIdsForSession(null)).toEqual([]);
  });

  it("reads occurred_at with a deterministic fallback", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T12:34:56.000Z"));

    expect(eventOccurredAt({ occurred_at: "2026-03-08T00:00:00.000Z" })).toBe(
      "2026-03-08T00:00:00.000Z",
    );
    expect(eventOccurredAt({ occurred_at: "   " })).toBe("2026-03-09T12:34:56.000Z");
    expect(eventOccurredAt(null)).toBe("2026-03-09T12:34:56.000Z");

    vi.useRealTimers();
  });

  it("extracts approval session ids only from valid nested payloads", () => {
    expect(
      readApprovalSessionId({
        approval: {
          context: {
            session_id: "session-123",
          },
        },
      }),
    ).toBe("session-123");
    expect(readApprovalSessionId({ approval: { context: {} } })).toBeNull();
    expect(readApprovalSessionId(null)).toBeNull();
    expect(
      readApprovalThreadId({
        approval: {
          context: {
            thread_id: "thread-123",
          },
        },
      }),
    ).toBe("thread-123");
  });

  it("builds approval transcript items from valid payloads", () => {
    expect(
      toApprovalTranscriptItem(
        {
          approval: {
            approval_id: "approval-1",
            status: "pending",
            prompt: "Approve deployment?",
            created_at: "2026-03-09T00:00:01.000Z",
            scope: {
              run_id: "run-1",
            },
          },
        },
        "2026-03-09T00:00:02.000Z",
      ),
    ).toEqual({
      kind: "approval",
      id: "approval-1",
      approval_id: "approval-1",
      status: "pending",
      title: "Approval required",
      detail: "Approve deployment?",
      created_at: "2026-03-09T00:00:01.000Z",
      updated_at: "2026-03-09T00:00:02.000Z",
      run_id: "run-1",
    });

    expect(
      toApprovalTranscriptItem(
        {
          approval: {
            approval_id: "",
            status: "pending",
            prompt: "Approve deployment?",
          },
        },
        "2026-03-09T00:00:02.000Z",
      ),
    ).toBeNull();
  });

  it("builds tool transcript items from valid payloads", () => {
    expect(
      toToolTranscriptItem(
        {
          tool_call_id: "tool-call-1",
          tool_id: "shell.exec",
          status: "failed",
          summary: "Command failed",
          duration_ms: 125,
          error: "permission denied",
          run_id: "run-1",
          agent_id: "agent-1",
          workspace_id: "workspace-1",
          channel: "ui",
          thread_id: "thread-1",
        },
        "2026-03-09T00:00:03.000Z",
      ),
    ).toEqual({
      kind: "tool",
      id: "tool-call-1",
      tool_id: "shell.exec",
      tool_call_id: "tool-call-1",
      status: "failed",
      summary: "Command failed",
      created_at: "2026-03-09T00:00:03.000Z",
      updated_at: "2026-03-09T00:00:03.000Z",
      duration_ms: 125,
      error: "permission denied",
      run_id: "run-1",
      agent_id: "agent-1",
      workspace_id: "workspace-1",
      channel: "ui",
      thread_id: "thread-1",
    });

    expect(
      toToolTranscriptItem(
        {
          tool_call_id: "",
          tool_id: "shell.exec",
          status: "running",
        },
        "2026-03-09T00:00:03.000Z",
      ),
    ).toBeNull();
  });

  it("accumulates streaming text and reasoning deltas", () => {
    const session = sessionWithTranscript([]);
    const withText = appendTranscriptTextDelta(session, {
      id: "msg-1",
      role: "assistant",
      delta: "Hello",
      occurredAt: "2026-03-09T00:00:03.000Z",
    });
    const withMoreText = appendTranscriptTextDelta(withText, {
      id: "msg-1",
      role: "assistant",
      delta: " world",
      occurredAt: "2026-03-09T00:00:04.000Z",
    });
    const withReasoning = appendTranscriptReasoningDelta(withMoreText, {
      id: "reason-1",
      delta: "Plan",
      occurredAt: "2026-03-09T00:00:02.000Z",
    });

    expect(withReasoning.transcript).toEqual([
      {
        kind: "reasoning",
        id: "reason-1",
        content: "Plan",
        created_at: "2026-03-09T00:00:02.000Z",
        updated_at: "2026-03-09T00:00:02.000Z",
      },
      {
        kind: "text",
        id: "msg-1",
        role: "assistant",
        content: "Hello world",
        created_at: "2026-03-09T00:00:03.000Z",
      },
    ]);
  });

  it("builds reasoning transcript items from valid payloads", () => {
    expect(
      toReasoningTranscriptItem(
        {
          reasoning_id: "reason-1",
          content: "Need to compare the inputs",
        },
        "2026-03-09T00:00:05.000Z",
      ),
    ).toEqual({
      kind: "reasoning",
      id: "reason-1",
      content: "Need to compare the inputs",
      created_at: "2026-03-09T00:00:05.000Z",
      updated_at: "2026-03-09T00:00:05.000Z",
    });
  });
});
