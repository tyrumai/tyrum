import type { AgentTurnRequest as AgentTurnRequestT } from "@tyrum/contracts";
import { describe, expect, it } from "vitest";
import { resolveAgentTurnInput } from "../../src/modules/agent/runtime/turn-helpers.js";

describe("resolveAgentTurnInput", () => {
  it("rejects turns with only empty text parts", () => {
    const input: AgentTurnRequestT = {
      channel: "test",
      thread_id: "thread-1",
      parts: [{ type: "text", text: "" }],
    };

    expect(() => resolveAgentTurnInput(input)).toThrow(
      "turn input is required (parts or envelope content)",
    );
  });

  it("rejects turns with only non-renderable parts", () => {
    const input: AgentTurnRequestT = {
      channel: "test",
      thread_id: "thread-1",
      parts: [{ type: "custom" }],
    };

    expect(() => resolveAgentTurnInput(input)).toThrow(
      "turn input is required (parts or envelope content)",
    );
  });
});
