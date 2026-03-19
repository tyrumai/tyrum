import { describe, expect, it } from "vitest";
import * as Schemas from "../src/index.js";
import * as Protocol from "../src/protocol.js";
import { WsRequest, WsResponse } from "../src/protocol.js";
import { expectRejects } from "./test-helpers.js";

describe("Session v1 WS protocol", () => {
  it("exports chat.session.* WS schemas from @tyrum/contracts", () => {
    expect("WsChatSessionListRequest" in Schemas).toBe(true);
    expect("WsChatSessionGetRequest" in Schemas).toBe(true);
    expect("WsChatSessionCreateRequest" in Schemas).toBe(true);
    expect("WsChatSessionDeleteRequest" in Schemas).toBe(true);
    expect("WsChatSessionReconnectRequest" in Schemas).toBe(true);
    expect("WsChatSessionSendRequest" in Schemas).toBe(true);
    expect("WsAiSdkChatStreamEvent" in Schemas).toBe(true);
    expect("SessionContextState" in Schemas).toBe(true);
    expect("CheckpointSummary" in Schemas).toBe(true);
  });

  it("exports chat.session.* WS operation schemas from ../src/protocol.js", () => {
    expect("WsChatSessionListRequest" in Protocol).toBe(true);
    expect("WsChatSessionGetRequest" in Protocol).toBe(true);
    expect("WsChatSessionCreateRequest" in Protocol).toBe(true);
    expect("WsChatSessionDeleteRequest" in Protocol).toBe(true);
    expect("WsChatSessionReconnectRequest" in Protocol).toBe(true);
    expect("WsChatSessionSendRequest" in Protocol).toBe(true);
    expect("WsSessionListRequest" in Protocol).toBe(false);
    expect("WsSessionGetRequest" in Protocol).toBe(false);
    expect("WsSessionCreateRequest" in Protocol).toBe(false);
    expect("WsSessionDeleteRequest" in Protocol).toBe(false);
    expect("WsSessionCompactRequest" in Protocol).toBe(false);
    expect("WsSessionSendRequest" in Protocol).toBe(false);
  });

  it("parses session context state checkpoints", () => {
    const parsed = Schemas.SessionContextState.safeParse({
      version: 1,
      compacted_through_message_id: "msg-3",
      recent_message_ids: ["msg-4", "msg-5"],
      checkpoint: {
        goal: "Ship the migration cleanly",
        user_constraints: ["touch schema/client only"],
        decisions: ["chat.session.* is the public request surface"],
        discoveries: ["gateway already has a private SessionContextState"],
        completed_work: ["added chat session transport"],
        pending_work: ["switch gateway compaction to shared schema"],
        unresolved_questions: ["whether chat.session.get should expose context_state"],
        critical_identifiers: ["session-1", "stream-1"],
        relevant_files: ["packages/contracts/src/session-context.ts"],
        handoff_md: "Continue from the shared session context state.",
      },
      pending_approvals: [
        {
          approval_id: "approval-1",
          approved: true,
          state: "approved",
          tool_call_id: "tool-call-1",
          tool_name: "exec_command",
        },
      ],
      pending_tool_state: [
        {
          summary: "Running migration verification",
          tool_call_id: "tool-call-2",
          tool_name: "pnpm test",
        },
      ],
      updated_at: "2026-03-13T12:00:00Z",
    });

    expect(parsed.success).toBe(true);
  });

  it("parses chat.session.* requests via WsRequest union", () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    const message = {
      id: "msg-1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    };

    const requests: Array<{ type: string; payload: unknown }> = [
      { type: "chat.session.list", payload: { agent_id: "default", channel: "ui", limit: 50 } },
      { type: "chat.session.get", payload: { session_id: sessionId } },
      { type: "chat.session.create", payload: { agent_id: "default", channel: "ui" } },
      { type: "chat.session.delete", payload: { session_id: sessionId } },
      { type: "chat.session.reconnect", payload: { session_id: sessionId } },
      {
        type: "chat.session.send",
        payload: {
          session_id: sessionId,
          message_id: "msg-1",
          messages: [message],
          trigger: "submit-message",
        },
      },
    ];

    for (const entry of requests) {
      const parsed = WsRequest.safeParse({
        request_id: `r-${entry.type}`,
        type: entry.type,
        payload: entry.payload,
      });
      expect(parsed.success, entry.type).toBe(true);
    }
  });

  it("parses chat.session.* responses via WsResponse union", () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    const now = "2026-03-13T12:00:00Z";
    const sessionSummary = {
      session_id: sessionId,
      agent_id: "default",
      channel: "ui",
      thread_id: "ui-550e8400-e29b-41d4-a716-446655440000",
      title: "Hello",
      message_count: 1,
      updated_at: now,
      created_at: now,
      last_message: { role: "user", text: "Hello" },
    };
    const session = {
      ...sessionSummary,
      messages: [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ],
    };

    const responses: Array<{ type: string; result: unknown }> = [
      { type: "chat.session.list", result: { sessions: [sessionSummary], next_cursor: null } },
      { type: "chat.session.get", result: { session } },
      { type: "chat.session.create", result: { session } },
      { type: "chat.session.delete", result: { session_id: sessionId } },
      { type: "chat.session.reconnect", result: { stream_id: "stream-1" } },
      { type: "chat.session.send", result: { stream_id: "stream-1" } },
    ];

    for (const entry of responses) {
      const parsed = WsResponse.safeParse({
        request_id: `r-${entry.type}`,
        type: entry.type,
        ok: true,
        result: entry.result,
      });
      expect(parsed.success, entry.type).toBe(true);
    }
  });

  it("parses session event payloads with thread_id via WsEvent union", () => {
    const agentId = "550e8400-e29b-41d4-a716-446655440000";
    const events = [
      {
        event_id: "e-typing-1",
        type: "typing.started",
        occurred_at: "2026-03-11T12:00:00Z",
        scope: { kind: "agent", agent_id: agentId },
        payload: {
          session_id: "session-1",
          thread_id: "ui-thread-1",
          lane: "assistant",
        },
      },
      {
        event_id: "e-message-delta-1",
        type: "message.delta",
        occurred_at: "2026-03-11T12:00:00Z",
        scope: { kind: "agent", agent_id: agentId },
        payload: {
          session_id: "session-1",
          thread_id: "ui-thread-1",
          lane: "assistant",
          message_id: "assistant-1",
          role: "assistant",
          delta: "hello",
        },
      },
      {
        event_id: "e-message-final-1",
        type: "message.final",
        occurred_at: "2026-03-11T12:00:00Z",
        scope: { kind: "agent", agent_id: agentId },
        payload: {
          session_id: "session-1",
          thread_id: "ui-thread-1",
          lane: "assistant",
          message_id: "assistant-1",
          role: "assistant",
          content: "hello",
        },
      },
    ];

    for (const event of events) {
      const parsed = Protocol.WsEvent.safeParse(event);
      expect(parsed.success, event.type).toBe(true);
    }
  });

  it("parses AI SDK chat stream events via WsEvent union", () => {
    const parsed = Protocol.WsEvent.safeParse({
      event_id: "e-stream-1",
      type: "chat.ui-message.stream",
      occurred_at: "2026-03-13T12:00:00Z",
      scope: { kind: "agent", agent_id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: {
        stream_id: "stream-1",
        stage: "chunk",
        chunk: { id: "text-1", type: "text-start" },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects chat.session.* request envelopes missing payload", () => {
    expectRejects(WsRequest, { request_id: "r-missing-payload", type: "chat.session.list" });
  });

  it("rejects error responses missing error payload", () => {
    expectRejects(WsResponse, {
      request_id: "r-missing-error",
      type: "chat.session.list",
      ok: false,
    });
  });
});
