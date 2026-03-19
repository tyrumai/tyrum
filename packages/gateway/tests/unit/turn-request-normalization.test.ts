import type { AgentTurnRequest as AgentTurnRequestT } from "@tyrum/schemas";
import { describe, expect, it } from "vitest";
import {
  normalizeInternalTurnRequestIfNeeded,
  normalizeInternalTurnRequestUnknown,
} from "../../src/modules/agent/runtime/turn-request-normalization.js";

describe("turn request normalization", () => {
  it("does not re-normalize requests that already have parts", () => {
    const input: AgentTurnRequestT = {
      channel: "test",
      thread_id: "thread-1",
      parts: [{ type: "text", text: "hello" }],
    };

    expect(normalizeInternalTurnRequestIfNeeded(input)).toBe(input);
  });

  it("still normalizes legacy message-only requests", () => {
    const normalized = normalizeInternalTurnRequestUnknown({
      channel: "test",
      thread_id: "thread-1",
      message: "  hello  ",
    });

    expect(normalized).toEqual({
      channel: "test",
      thread_id: "thread-1",
      message: "  hello  ",
      parts: [{ type: "text", text: "hello" }],
    });
  });
});
