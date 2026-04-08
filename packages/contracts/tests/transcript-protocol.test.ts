import { describe, expect, it } from "vitest";
import * as Schemas from "../src/index.js";
import * as Protocol from "../src/protocol.js";
import { WsRequest, WsResponse } from "../src/protocol.js";
import { expectRejects } from "./test-helpers.js";

describe("Transcript WS protocol", () => {
  it("exports transcript WS schemas from @tyrum/contracts and protocol entrypoints", () => {
    expect("WsTranscriptListRequest" in Schemas).toBe(true);
    expect("WsTranscriptGetRequest" in Schemas).toBe(true);
    expect("TranscriptConversationSummary" in Schemas).toBe(true);
    expect("TranscriptTimelineEvent" in Schemas).toBe(true);
    expect("WsTranscriptListRequest" in Protocol).toBe(true);
    expect("WsTranscriptGetRequest" in Protocol).toBe(true);
  });

  it("parses transcript requests via the shared WsRequest union", () => {
    const requests: Array<{ type: string; payload: unknown }> = [
      {
        type: "transcript.list",
        payload: {
          agent_key: "default",
          channel: "ui",
          active_only: true,
          archived: false,
          limit: 25,
          cursor: "cursor-1",
        },
      },
      {
        type: "transcript.get",
        payload: {
          conversation_key: "conversation-root-1",
        },
      },
    ];

    for (const entry of requests) {
      const parsed = WsRequest.safeParse({
        request_id: `req-${entry.type}`,
        type: entry.type,
        payload: entry.payload,
      });
      expect(parsed.success, entry.type).toBe(true);
    }
  });

  it("parses transcript responses with nested child summaries via the shared WsResponse union", () => {
    const turnConversationKey = "agent:default:ui:default:channel:thread-root-1";
    const conversationSummary = {
      conversation_id: "conversation-root-1-id",
      conversation_key: "conversation-root-1",
      agent_key: "default",
      channel: "ui",
      account_key: "default",
      thread_id: "thread-root-1",
      container_kind: "channel",
      title: "Root conversation",
      message_count: 2,
      updated_at: "2026-03-13T12:00:00Z",
      created_at: "2026-03-13T11:00:00Z",
      archived: false,
      latest_turn_id: null,
      latest_turn_status: null,
      has_active_turn: false,
      pending_approval_count: 0,
      child_conversations: [
        {
          conversation_id: "conversation-child-1-id",
          conversation_key: "conversation-child-1",
          agent_key: "default",
          channel: "ui",
          account_key: "default",
          thread_id: "thread-child-1",
          container_kind: "channel",
          title: "Child conversation",
          message_count: 1,
          updated_at: "2026-03-13T12:00:30Z",
          created_at: "2026-03-13T11:30:00Z",
          archived: false,
          parent_conversation_key: "conversation-root-1",
          subagent_id: "subagent-1",
          latest_turn_id: "turn-1",
          latest_turn_status: "running",
          has_active_turn: true,
          pending_approval_count: 1,
        },
      ],
    };

    const listParsed = WsResponse.safeParse({
      request_id: "req-transcript.list",
      type: "transcript.list",
      ok: true,
      result: {
        conversations: [conversationSummary],
        next_cursor: "cursor-2",
      },
    });
    expect(listParsed.success).toBe(true);

    const getParsed = WsResponse.safeParse({
      request_id: "req-transcript.get",
      type: "transcript.get",
      ok: true,
      result: {
        root_conversation_key: "conversation-root-1",
        focus_conversation_key: "conversation-child-1",
        conversations: [
          {
            ...conversationSummary,
            child_conversations: undefined,
          },
          {
            ...conversationSummary.child_conversations[0],
          },
        ],
        events: [
          {
            event_id: "message:conversation-root-1:msg-1",
            kind: "message",
            occurred_at: "2026-03-13T12:00:00Z",
            conversation_key: "conversation-root-1",
            payload: {
              message: {
                id: "msg-1",
                role: "user",
                parts: [{ type: "text", text: "inspect" }],
              },
            },
          },
          {
            event_id: "turn:turn-1",
            kind: "turn",
            occurred_at: "2026-03-13T12:01:00Z",
            conversation_key: "conversation-root-1",
            payload: {
              turn: {
                turn_id: "11111111-2222-4333-8444-555555555555",
                job_id: "11111111-2222-4333-8444-666666666666",
                conversation_key: turnConversationKey,
                status: "running",
                attempt: 1,
                created_at: "2026-03-13T12:01:00Z",
                started_at: "2026-03-13T12:01:01Z",
                finished_at: null,
              },
              turn_items: [
                {
                  turn_item_id: "11111111-2222-4333-8444-777777777777",
                  turn_id: "11111111-2222-4333-8444-555555555555",
                  item_index: 0,
                  item_key: "message:user-msg-1",
                  kind: "message",
                  created_at: "2026-03-13T12:01:02Z",
                  payload: {
                    message: {
                      id: "user-msg-1",
                      role: "user",
                      parts: [{ type: "text", text: "inspect transcript" }],
                    },
                  },
                },
              ],
            },
          },
          {
            event_id: "tool_lifecycle:event-1",
            kind: "tool_lifecycle",
            occurred_at: "2026-03-13T12:01:03Z",
            conversation_key: "conversation-root-1",
            payload: {
              tool_event: {
                conversation_id: "conversation-root-1-id",
                thread_id: "thread-root-1",
                tool_call_id: "tool-call-1",
                tool_id: "tool.location.get",
                status: "completed",
                summary: "Resolved current location.",
              },
            },
          },
          {
            event_id: "context_report:report-1",
            kind: "context_report",
            occurred_at: "2026-03-13T12:01:04Z",
            conversation_key: "conversation-root-1",
            payload: {
              report: {
                context_report_id: "550e8400-e29b-41d4-a716-446655440200",
                generated_at: "2026-03-13T12:01:04Z",
                conversation_id: "conversation-root-1-id",
                channel: "ui",
                thread_id: "thread-root-1",
                agent_id: "11111111-2222-4333-8444-555555555555",
                workspace_id: "11111111-2222-4333-8444-666666666666",
                system_prompt: { chars: 10, sections: [] },
                user_parts: [],
                selected_tools: [],
                tool_schema_top: [],
                tool_schema_total_chars: 0,
                enabled_skills: [],
                mcp_servers: [],
                memory: { keyword_hits: 1, semantic_hits: 2 },
                pre_turn_tools: [],
                tool_calls: [],
                injected_files: [],
              },
            },
          },
        ],
      },
    });
    expect(getParsed.success).toBe(true);
  });

  it("rejects transcript.list payloads that still use agent_id instead of agent_key", () => {
    expectRejects(WsRequest, {
      request_id: "req-transcript.list",
      type: "transcript.list",
      payload: {
        agent_id: "default",
        channel: "ui",
      },
    });
  });
});
