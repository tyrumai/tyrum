import { describe, expect, it, vi } from "vitest";
import type { SessionTranscriptItem, WsSessionGetSession } from "@tyrum/client";
import {
  activeToolCallIdsForSession,
  eventOccurredAt,
  mergeFetchedTranscript,
  readApprovalSessionId,
  sortTranscriptItems,
  toApprovalTranscriptItem,
  toToolTranscriptItem,
  upsertTranscriptItem,
} from "../src/stores/chat-store-transcript.js";

function textItem(id: string, createdAt: string): Extract<SessionTranscriptItem, { kind: "text" }> {
  return {
    kind: "text",
    id,
    role: "user",
    content: id,
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
    session_id: "session-compat",
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

describe("chat-store-transcript compatibility helpers", () => {
  it("sorts, merges, and upserts transcript items", () => {
    const sorted = sortTranscriptItems([
      toolItem("tool", "2026-03-09T00:00:02.000Z", "running"),
      textItem("b", "2026-03-09T00:00:01.000Z"),
      textItem("a", "2026-03-09T00:00:01.000Z"),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["a", "b", "tool"]);

    const merged = mergeFetchedTranscript(
      [
        textItem("old", "2026-03-09T00:00:00.000Z"),
        toolItem("overlay", "2026-03-09T00:00:03.000Z", "running"),
      ],
      [textItem("fresh", "2026-03-09T00:00:02.000Z")],
    );
    expect(merged.map((item) => item.id)).toEqual(["fresh", "overlay"]);

    const updated = upsertTranscriptItem(
      sessionWithTranscript([textItem("message", "2026-03-09T00:00:01.000Z")]),
      toolItem("later", "2026-03-09T00:00:04.000Z", "queued"),
    );
    expect(updated.transcript.map((item) => item.id)).toEqual(["message", "later"]);
  });

  it("tracks active tool calls and falls back occurred_at timestamps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T08:00:00.000Z"));

    expect(
      activeToolCallIdsForSession(
        sessionWithTranscript([
          toolItem("queued", "2026-03-09T00:00:01.000Z", "queued"),
          toolItem("done", "2026-03-09T00:00:02.000Z", "completed"),
        ]),
      ),
    ).toEqual(["call-queued"]);
    expect(eventOccurredAt({ occurred_at: "" })).toBe("2026-03-09T08:00:00.000Z");
    expect(eventOccurredAt({ occurred_at: "2026-03-08T08:00:00.000Z" })).toBe(
      "2026-03-08T08:00:00.000Z",
    );

    vi.useRealTimers();
  });

  it("extracts approval session ids and builds approval transcript items", () => {
    expect(
      readApprovalSessionId({
        approval: {
          context: {
            session_id: "session-compat",
          },
        },
      }),
    ).toBe("session-compat");
    expect(readApprovalSessionId({ approval: {} })).toBeNull();

    expect(
      toApprovalTranscriptItem(
        {
          approval: {
            approval_id: "approval-compat",
            status: "approved",
            prompt: "Proceed",
            scope: {
              run_id: "run-compat",
            },
          },
        },
        "2026-03-09T00:00:02.000Z",
      ),
    ).toMatchObject({
      approval_id: "approval-compat",
      status: "approved",
      detail: "Proceed",
      run_id: "run-compat",
      created_at: "2026-03-09T00:00:02.000Z",
    });
    expect(
      toApprovalTranscriptItem({ approval: { prompt: "missing" } }, "2026-03-09T00:00:02.000Z"),
    ).toBeNull();
  });

  it("builds tool transcript items and rejects invalid payloads", () => {
    expect(
      toToolTranscriptItem(
        {
          tool_call_id: "tool-call-compat",
          tool_id: "shell.exec",
          status: "running",
          error: "boom",
          duration_ms: 99,
        },
        "2026-03-09T00:00:03.000Z",
      ),
    ).toMatchObject({
      tool_call_id: "tool-call-compat",
      tool_id: "shell.exec",
      status: "running",
      error: "boom",
      duration_ms: 99,
    });
    expect(
      toToolTranscriptItem(
        { tool_call_id: "x", tool_id: "", status: "running" },
        "2026-03-09T00:00:03.000Z",
      ),
    ).toBeNull();
  });
});
