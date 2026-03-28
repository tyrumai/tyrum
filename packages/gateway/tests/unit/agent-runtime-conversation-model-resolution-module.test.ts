import { describe, expect, it } from "vitest";
import { resolveConversationModel } from "../../src/modules/agent/runtime/conversation-model-resolution.js";

describe("conversation-model-resolution module", () => {
  it("exports resolveConversationModel", () => {
    expect(typeof resolveConversationModel).toBe("function");
  });
});
