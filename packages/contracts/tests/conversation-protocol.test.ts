import { describe, expect, it } from "vitest";
import * as Schemas from "../src/index.js";
import * as Protocol from "../src/protocol.js";
import { WsRequest, WsResponse } from "../src/protocol.js";
import { expectRejects } from "./test-helpers.js";

describe("Conversation v1 WS protocol", () => {
  it("exports conversation.* WS schemas from @tyrum/contracts", () => {
    expect("WsConversationListRequest" in Schemas).toBe(true);
    expect("WsConversationGetRequest" in Schemas).toBe(true);
    expect("WsConversationCreateRequest" in Schemas).toBe(true);
    expect("WsConversationDeleteRequest" in Schemas).toBe(true);
    expect("WsConversationQueueModeSetRequest" in Schemas).toBe(true);
    expect("WsConversationReconnectRequest" in Schemas).toBe(true);
    expect("WsConversationSendRequest" in Schemas).toBe(true);
    expect("WsAiSdkChatStreamEvent" in Schemas).toBe(true);
    expect("ConversationState" in Schemas).toBe(true);
    expect("CheckpointSummary" in Schemas).toBe(true);
  });

  it("exports conversation.* WS operation schemas from ../src/protocol.js", () => {
    expect("WsConversationListRequest" in Protocol).toBe(true);
    expect("WsConversationGetRequest" in Protocol).toBe(true);
    expect("WsConversationCreateRequest" in Protocol).toBe(true);
    expect("WsConversationDeleteRequest" in Protocol).toBe(true);
    expect("WsConversationQueueModeSetRequest" in Protocol).toBe(true);
    expect("WsConversationReconnectRequest" in Protocol).toBe(true);
    expect("WsConversationSendRequest" in Protocol).toBe(true);
    expect("WsChatConversationListRequest" in Protocol).toBe(false);
    expect("WsChatConversationGetRequest" in Protocol).toBe(false);
  });

  it("parses conversation state checkpoints", () => {
    const parsed = Schemas.ConversationState.safeParse({
      version: 1,
      compacted_through_message_id: "msg-3",
      recent_message_ids: ["msg-4", "msg-5"],
      checkpoint: {
        goal: "Ship the migration cleanly",
        user_constraints: ["touch schema/client only"],
        decisions: ["conversation.* is the public request surface"],
        discoveries: ["gateway already has a private conversation state projection"],
        completed_work: ["added conversation transport"],
        pending_work: ["switch gateway compaction to shared schema"],
        unresolved_questions: ["whether conversation.get should expose conversation_state"],
        critical_identifiers: ["conversation-1", "stream-1"],
        relevant_files: ["packages/contracts/src/conversation-state.ts"],
        handoff_md: "Continue from the shared conversation state.",
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

  it("parses conversation.* requests via WsRequest union", () => {
    const conversationId = "550e8400-e29b-41d4-a716-446655440000";
    const message = {
      id: "msg-1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    };

    const requests: Array<{ type: string; payload: unknown }> = [
      { type: "conversation.list", payload: { agent_key: "default", channel: "ui", limit: 50 } },
      { type: "conversation.get", payload: { conversation_id: conversationId } },
      { type: "conversation.create", payload: { agent_key: "default", channel: "ui" } },
      { type: "conversation.delete", payload: { conversation_id: conversationId } },
      {
        type: "conversation.queue_mode.set",
        payload: { conversation_id: conversationId, queue_mode: "steer" },
      },
      { type: "conversation.reconnect", payload: { conversation_id: conversationId } },
      {
        type: "conversation.send",
        payload: {
          conversation_id: conversationId,
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

  it("parses conversation.* responses via WsResponse union", () => {
    const conversationId = "550e8400-e29b-41d4-a716-446655440000";
    const now = "2026-03-13T12:00:00Z";
    const conversationSummary = {
      conversation_id: conversationId,
      agent_key: "default",
      channel: "ui",
      account_key: "default",
      thread_id: "ui-550e8400-e29b-41d4-a716-446655440000",
      container_kind: "channel",
      title: "Hello",
      message_count: 1,
      updated_at: now,
      created_at: now,
      last_message: { role: "user", text: "Hello" },
    };
    const conversation = {
      ...conversationSummary,
      queue_mode: "steer",
      messages: [
        {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ],
    };

    const responses: Array<{ type: string; result: unknown }> = [
      {
        type: "conversation.list",
        result: { conversations: [conversationSummary], next_cursor: null },
      },
      { type: "conversation.get", result: { conversation } },
      { type: "conversation.create", result: { conversation } },
      { type: "conversation.delete", result: { conversation_id: conversationId } },
      {
        type: "conversation.queue_mode.set",
        result: { conversation_id: conversationId, queue_mode: "interrupt" },
      },
      { type: "conversation.reconnect", result: { stream_id: "stream-1" } },
      { type: "conversation.send", result: { stream_id: "stream-1" } },
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

  it("rejects conversation.* payloads that still use agent_id instead of agent_key", () => {
    expectRejects(WsRequest, {
      request_id: "r-conversation.list",
      type: "conversation.list",
      payload: {
        agent_id: "default",
        channel: "ui",
      },
    });
    expectRejects(WsRequest, {
      request_id: "r-conversation.create",
      type: "conversation.create",
      payload: {
        agent_id: "default",
        channel: "ui",
      },
    });
  });

  it("parses conversation event payloads with thread_id via WsEvent union", () => {
    const agentId = "550e8400-e29b-41d4-a716-446655440000";
    const events = [
      {
        event_id: "e-typing-1",
        type: "typing.started",
        occurred_at: "2026-03-11T12:00:00Z",
        scope: { kind: "agent", agent_id: agentId },
        payload: {
          conversation_id: "conversation-1",
          thread_id: "ui-thread-1",
        },
      },
      {
        event_id: "e-message-delta-1",
        type: "message.delta",
        occurred_at: "2026-03-11T12:00:00Z",
        scope: { kind: "agent", agent_id: agentId },
        payload: {
          conversation_id: "conversation-1",
          thread_id: "ui-thread-1",
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
          conversation_id: "conversation-1",
          thread_id: "ui-thread-1",
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

  it("rejects conversation.* request envelopes missing payload", () => {
    expectRejects(WsRequest, {
      request_id: "r-missing-payload",
      type: "conversation.list",
    });
  });

  it("rejects error responses missing error payload", () => {
    expectRejects(WsResponse, {
      request_id: "r-missing-error",
      type: "conversation.list",
      ok: false,
    });
  });
});
