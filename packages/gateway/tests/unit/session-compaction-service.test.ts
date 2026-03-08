import { describe, expect, it } from "vitest";
import {
  isContextOverflowError,
  shouldCompactSessionForUsage,
} from "../../src/modules/agent/runtime/session-compaction-service.js";

describe("isContextOverflowError", () => {
  it("matches common model context overflow messages", () => {
    expect(
      isContextOverflowError(new Error("This model's maximum context length is 128000 tokens.")),
    ).toBe(true);
    expect(isContextOverflowError(new Error("Prompt is too large for this model."))).toBe(true);
  });

  it("does not treat unrelated too-large errors as context overflow", () => {
    expect(isContextOverflowError(new Error("413 Payload Too Large"))).toBe(false);
    expect(isContextOverflowError(new Error("request body too large"))).toBe(false);
    expect(isContextOverflowError(new Error("response body too large"))).toBe(false);
    expect(isContextOverflowError(new Error("file too large"))).toBe(false);
  });
});

describe("shouldCompactSessionForUsage", () => {
  it("does not fall back to turn-count compaction when max_turns is disabled", () => {
    expect(
      shouldCompactSessionForUsage({
        config: {
          sessions: { max_turns: 0, compaction: { auto: true, reserved_input_tokens: 20_000 } },
        } as never,
        session: {
          turns: [
            { role: "user", content: "m1", timestamp: "2026-03-08T00:00:00Z" },
            { role: "assistant", content: "r1", timestamp: "2026-03-08T00:00:00Z" },
          ],
        } as never,
        modelResolution: { candidates: [] } as never,
        usage: { inputTokens: 999_999 },
      }),
    ).toBe(false);
  });

  it("uses deprecated max_turns fallback only when configured to a positive value", () => {
    expect(
      shouldCompactSessionForUsage({
        config: {
          sessions: { max_turns: 2, compaction: { auto: true, reserved_input_tokens: 20_000 } },
        } as never,
        session: {
          turns: [
            { role: "user", content: "m1", timestamp: "2026-03-08T00:00:00Z" },
            { role: "assistant", content: "r1", timestamp: "2026-03-08T00:00:00Z" },
            { role: "user", content: "m2", timestamp: "2026-03-08T00:00:01Z" },
            { role: "assistant", content: "r2", timestamp: "2026-03-08T00:00:01Z" },
          ],
        } as never,
        modelResolution: { candidates: [] } as never,
        usage: undefined,
      }),
    ).toBe(true);
  });
});
