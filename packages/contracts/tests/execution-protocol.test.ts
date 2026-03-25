import { describe, expect, it } from "vitest";
import * as Protocol from "../src/protocol.js";
import { WsResponse } from "../src/protocol.js";

describe("Execution WS protocol", () => {
  it("parses run.list responses with optional session linkage metadata", () => {
    const parsed = WsResponse.safeParse({
      request_id: "req-run.list",
      type: "run.list",
      ok: true,
      result: {
        runs: [
          {
            run: {
              run_id: "550e8400-e29b-41d4-a716-446655440000",
              job_id: "550e8400-e29b-41d4-a716-446655440001",
              key: "agent:default:main",
              lane: "main",
              status: "running",
              attempt: 1,
              created_at: "2026-03-13T12:00:00Z",
              started_at: "2026-03-13T12:00:01Z",
              finished_at: null,
            },
            agent_key: "default",
            session_key: "agent:default:main",
          },
          {
            run: {
              run_id: "550e8400-e29b-41d4-a716-446655440002",
              job_id: "550e8400-e29b-41d4-a716-446655440003",
              key: "cron:daily-report",
              lane: "cron",
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

  it("exports run.list schemas from the protocol entrypoint", () => {
    expect("WsRunListRequest" in Protocol).toBe(true);
    expect("WsRunListResult" in Protocol).toBe(true);
    expect("WsRunListResponseEnvelope" in Protocol).toBe(true);
  });
});
