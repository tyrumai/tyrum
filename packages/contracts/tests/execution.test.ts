import { describe, expect, it } from "vitest";
import {
  AttemptCost,
  Turn,
  TurnItem,
  TurnBlockedPayload,
  TurnJob,
  TurnJobStatus,
  TurnStatus,
} from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("Execution engine contracts", () => {
  const baseJob = {
    job_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    conversation_key: "agent:agent-1:main",
    status: "queued",
    created_at: "2026-02-19T12:00:00Z",
    trigger: {
      kind: "conversation",
      conversation_key: "agent:agent-1:main",
    },
  } as const;

  const baseTurn = {
    turn_id: "550e8400-e29b-41d4-a716-446655440000",
    job_id: baseJob.job_id,
    conversation_key: "agent:agent-1:main",
    status: "running",
    attempt: 1,
    created_at: "2026-02-19T12:00:00Z",
    started_at: "2026-02-19T12:00:01Z",
    finished_at: null,
  } as const;

  const baseCost = {
    duration_ms: 1234,
    input_tokens: 10,
    output_tokens: 20,
    total_tokens: 30,
    usd_micros: 123_000,
    model: "gpt-4.1-mini",
    provider: "openai",
  } as const;

  const baseTurnItem = {
    turn_item_id: "11111111-2222-4333-8444-555555555555",
    turn_id: baseTurn.turn_id,
    item_index: 0,
    item_key: "message:user-msg-1",
    kind: "message",
    created_at: "2026-02-19T12:00:00Z",
    payload: {
      message: {
        id: "user-msg-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
        metadata: { turn_id: baseTurn.turn_id },
      },
    },
  } as const;

  it("parses a job record", () => {
    const job = TurnJob.parse(baseJob);
    expect(job.status).toBe("queued");
  });

  it("rejects a job record with wrong job_id type", () => {
    expectRejects(TurnJob, { ...baseJob, job_id: 123 });
  });

  it("rejects a job record missing trigger", () => {
    const bad = { ...baseJob } as Record<string, unknown>;
    delete bad.trigger;
    expectRejects(TurnJob, bad);
  });

  it("parses a turn record", () => {
    const turn = Turn.parse(baseTurn);
    expect(turn.status).toBe("running");
  });

  it("rejects a turn record with wrong attempt type", () => {
    expectRejects(Turn, { ...baseTurn, attempt: "1" });
  });

  it("rejects a turn record missing started_at", () => {
    const bad = { ...baseTurn } as Record<string, unknown>;
    delete bad.started_at;
    expectRejects(Turn, bad);
  });

  it("parses a turn item record", () => {
    const item = TurnItem.parse(baseTurnItem);
    expect(item.kind).toBe("message");
    expect(item.payload.message.id).toBe("user-msg-1");
  });

  it("rejects a turn item record with invalid payload", () => {
    expectRejects(TurnItem, {
      ...baseTurnItem,
      payload: {
        message: {
          id: "",
          role: "user",
          parts: [],
        },
      },
    });
  });

  it("parses attempt cost attribution", () => {
    const cost = AttemptCost.parse(baseCost);
    expect(cost.total_tokens).toBe(30);
  });

  it("rejects attempt cost with wrong token types", () => {
    expectRejects(AttemptCost, { ...baseCost, total_tokens: "30" });
  });

  it("rejects attempt cost with negative duration_ms", () => {
    expectRejects(AttemptCost, { ...baseCost, duration_ms: -1 });
  });

  it("exports stable status enums", () => {
    expect(TurnStatus.options).toContain("paused");
    expect(TurnJobStatus.options).toContain("running");
  });

  it("parses a turn blocked payload", () => {
    const payload = TurnBlockedPayload.parse({
      turn_id: "550e8400-e29b-41d4-a716-446655440000",
      reason: "approval",
      approval_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
    });
    expect(payload.reason).toBe("approval");
  });

  it("rejects a turn blocked payload with wrong approval_id type", () => {
    expectRejects(TurnBlockedPayload, {
      turn_id: "550e8400-e29b-41d4-a716-446655440000",
      reason: "approval",
      approval_id: 1,
    });
  });

  it("rejects a turn blocked payload missing turn_id", () => {
    const bad = {
      reason: "approval",
      approval_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
    } as const;
    expectRejects(TurnBlockedPayload, bad);
  });
});
