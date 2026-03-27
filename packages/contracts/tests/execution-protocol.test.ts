import { describe, expect, it } from "vitest";
import * as Protocol from "../src/protocol.js";
import { WsResponse } from "../src/protocol.js";

describe("Turn WS protocol", () => {
  it("parses turn.list responses with optional conversation linkage metadata", () => {
    const parsed = WsResponse.safeParse({
      request_id: "req-turn.list",
      type: "turn.list",
      ok: true,
      result: {
        turns: [
          {
            turn: {
              turn_id: "550e8400-e29b-41d4-a716-446655440000",
              job_id: "550e8400-e29b-41d4-a716-446655440001",
              conversation_key: "agent:default:main",
              status: "running",
              attempt: 1,
              created_at: "2026-03-13T12:00:00Z",
              started_at: "2026-03-13T12:00:01Z",
              finished_at: null,
            },
            agent_key: "default",
            conversation_key: "agent:default:main",
          },
          {
            turn: {
              turn_id: "550e8400-e29b-41d4-a716-446655440002",
              job_id: "550e8400-e29b-41d4-a716-446655440003",
              conversation_key: "agent:default:automation:default:channel:schedule-daily-report",
              status: "succeeded",
              attempt: 1,
              created_at: "2026-03-13T11:00:00Z",
              started_at: "2026-03-13T11:00:01Z",
              finished_at: "2026-03-13T11:01:00Z",
            },
            agent_key: "default",
          },
        ],
        steps: [],
        attempts: [],
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("exports turn.list schemas from the protocol entrypoint", () => {
    expect("WsTurnListRequest" in Protocol).toBe(true);
    expect("WsTurnListResult" in Protocol).toBe(true);
    expect("WsTurnListResponseEnvelope" in Protocol).toBe(true);
  });
});
