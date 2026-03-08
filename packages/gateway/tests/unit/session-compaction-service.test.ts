import { describe, expect, it } from "vitest";
import { isContextOverflowError } from "../../src/modules/agent/runtime/session-compaction-service.js";

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
