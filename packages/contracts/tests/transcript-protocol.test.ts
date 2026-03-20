import { describe, expect, it } from "vitest";
import * as Schemas from "../src/index.js";
import * as Protocol from "../src/protocol.js";
import { WsRequest, WsResponse } from "../src/protocol.js";

describe("Transcript WS protocol", () => {
  it("exports transcript WS schemas from @tyrum/contracts and protocol entrypoints", () => {
    expect("WsTranscriptListRequest" in Schemas).toBe(true);
    expect("WsTranscriptGetRequest" in Schemas).toBe(true);
    expect("TranscriptSessionSummary" in Schemas).toBe(true);
    expect("TranscriptTimelineEvent" in Schemas).toBe(true);
    expect("WsTranscriptListRequest" in Protocol).toBe(true);
    expect("WsTranscriptGetRequest" in Protocol).toBe(true);
  });

  it("parses transcript requests via the shared WsRequest union", () => {
    const requests: Array<{ type: string; payload: unknown }> = [
      {
        type: "transcript.list",
        payload: {
          agent_id: "default",
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
          session_key: "session-root-1",
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
    const sessionSummary = {
      session_id: "session-root-1-id",
      session_key: "session-root-1",
      agent_id: "default",
      channel: "ui",
      thread_id: "thread-root-1",
      title: "Root session",
      message_count: 2,
      updated_at: "2026-03-13T12:00:00Z",
      created_at: "2026-03-13T11:00:00Z",
      archived: false,
      latest_run_id: null,
      latest_run_status: null,
      has_active_run: false,
      pending_approval_count: 0,
      child_sessions: [
        {
          session_id: "session-child-1-id",
          session_key: "session-child-1",
          agent_id: "default",
          channel: "ui",
          thread_id: "thread-child-1",
          title: "Child session",
          message_count: 1,
          updated_at: "2026-03-13T12:00:30Z",
          created_at: "2026-03-13T11:30:00Z",
          archived: false,
          parent_session_key: "session-root-1",
          subagent_id: "subagent-1",
          latest_run_id: "run-1",
          latest_run_status: "running",
          has_active_run: true,
          pending_approval_count: 1,
        },
      ],
    };

    const listParsed = WsResponse.safeParse({
      request_id: "req-transcript.list",
      type: "transcript.list",
      ok: true,
      result: {
        sessions: [sessionSummary],
        next_cursor: "cursor-2",
      },
    });
    expect(listParsed.success).toBe(true);

    const getParsed = WsResponse.safeParse({
      request_id: "req-transcript.get",
      type: "transcript.get",
      ok: true,
      result: {
        root_session_key: "session-root-1",
        focus_session_key: "session-child-1",
        sessions: [
          {
            ...sessionSummary,
            child_sessions: undefined,
          },
          {
            ...sessionSummary.child_sessions[0],
          },
        ],
        events: [
          {
            event_id: "message:session-root-1:msg-1",
            kind: "message",
            occurred_at: "2026-03-13T12:00:00Z",
            session_key: "session-root-1",
            payload: {
              message: {
                id: "msg-1",
                role: "user",
                parts: [{ type: "text", text: "inspect" }],
              },
            },
          },
        ],
      },
    });
    expect(getParsed.success).toBe(true);
  });
});
