import { describe, expect, it } from "vitest";
import { expectedSpecificationVersionForNpm } from "../../src/modules/agent/runtime/session-model-resolution-helpers.js";

describe("expectedSpecificationVersionForNpm", () => {
  it("keeps GitLab on v2 and treats openai-compatible providers as v3", () => {
    expect(expectedSpecificationVersionForNpm("gitlab-ai-provider")).toBe("v2");
    expect(expectedSpecificationVersionForNpm("@jerome-benoit/sap-ai-provider-v2")).toBe("v2");
    expect(expectedSpecificationVersionForNpm("@ai-sdk/openai-compatible")).toBe("v3");
  });
});
