import { describe, expect, it } from "vitest";
import * as Schemas from "../src/index.js";
import * as Protocol from "../src/protocol.js";
import { WsRequest, WsResponse } from "../src/protocol.js";
import { expectRejects } from "./test-helpers.js";

describe("Session v1 WS protocol", () => {
  it("exports session.* WS schemas from @tyrum/schemas", () => {
    expect("WsSessionSendRequest" in Schemas).toBe(true);
    expect("WsSessionListRequest" in Schemas).toBe(true);
    expect("WsSessionGetRequest" in Schemas).toBe(true);
    expect("WsSessionCreateRequest" in Schemas).toBe(true);
    expect("WsSessionCompactRequest" in Schemas).toBe(true);
    expect("WsSessionDeleteRequest" in Schemas).toBe(true);
  });

  it("exports session.* WS operation schemas from ../src/protocol.js", () => {
    expect("WsSessionListRequest" in Protocol).toBe(true);
    expect("WsSessionGetRequest" in Protocol).toBe(true);
    expect("WsSessionCreateRequest" in Protocol).toBe(true);
    expect("WsSessionCompactRequest" in Protocol).toBe(true);
    expect("WsSessionDeleteRequest" in Protocol).toBe(true);
  });

  it("parses session.* requests via WsRequest union", () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";

    const requests: Array<{ type: string; payload: unknown }> = [
      { type: "session.list", payload: { agent_id: "default", channel: "ui", limit: 50 } },
      { type: "session.get", payload: { agent_id: "default", session_id: sessionId } },
      { type: "session.create", payload: { agent_id: "default", channel: "ui" } },
      { type: "session.compact", payload: { agent_id: "default", session_id: sessionId } },
      { type: "session.delete", payload: { agent_id: "default", session_id: sessionId } },
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

  it("parses session.* responses via WsResponse union", () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    const now = "2026-02-19T12:00:00Z";

    const sessionListItem = {
      session_id: sessionId,
      agent_id: "default",
      channel: "ui",
      thread_id: "ui-550e8400-e29b-41d4-a716-446655440000",
      title: "Hello",
      summary: "",
      transcript_count: 2,
      updated_at: now,
      created_at: now,
      last_text: { role: "assistant", content: "Hello" },
    };

    const session = {
      session_id: sessionId,
      agent_id: "default",
      channel: "ui",
      thread_id: sessionListItem.thread_id,
      title: sessionListItem.title,
      summary: "",
      transcript: [
        {
          kind: "text",
          id: "t-1",
          role: "user",
          content: "Hi",
          created_at: now,
        },
        {
          kind: "text",
          id: "t-2",
          role: "assistant",
          content: "Hello",
          created_at: now,
        },
      ],
      updated_at: now,
      created_at: now,
    };

    const responses: Array<{ type: string; result?: unknown }> = [
      { type: "session.list", result: { sessions: [sessionListItem], next_cursor: null } },
      { type: "session.get", result: { session } },
      {
        type: "session.create",
        result: {
          session_id: sessionId,
          agent_id: "default",
          channel: "ui",
          thread_id: sessionListItem.thread_id,
          title: "",
        },
      },
      {
        type: "session.compact",
        result: { session_id: sessionId, dropped_messages: 10, kept_messages: 8 },
      },
      { type: "session.delete", result: { session_id: sessionId } },
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

    const errorResponses: Array<{ type: string }> = [
      { type: "session.list" },
      { type: "session.get" },
      { type: "session.create" },
      { type: "session.compact" },
      { type: "session.delete" },
    ];

    for (const entry of errorResponses) {
      const parsed = WsResponse.safeParse({
        request_id: `r-err-${entry.type}`,
        type: entry.type,
        ok: false,
        error: { code: "bad_request", message: "boom" },
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

  it("rejects session.* request envelopes missing payload", () => {
    expectRejects(WsRequest, { request_id: "r-missing-payload", type: "session.list" });
  });

  it("rejects error responses missing error payload", () => {
    expectRejects(WsResponse, { request_id: "r-missing-error", type: "session.list", ok: false });
  });
});
