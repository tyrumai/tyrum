import { describe, expect, it } from "vitest";
import { resolveSessionModel } from "../../src/modules/agent/runtime/session-model-resolution.js";

describe("session-model-resolution module", () => {
  it("exports resolveSessionModel", () => {
    expect(typeof resolveSessionModel).toBe("function");
  });
});

