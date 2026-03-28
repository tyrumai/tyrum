import { describe, expect, it } from "vitest";
import { createTextChatMessage } from "../../src/modules/ai-sdk/message-utils.js";
import { buildCompactionInstruction } from "../../src/modules/agent/runtime/conversation-compaction-prompt.js";

describe("buildCompactionInstruction", () => {
  it("forbids invention and preserves exact identifiers when compacting", () => {
    const instruction = buildCompactionInstruction({
      previousCheckpoint: null,
      droppedMessages: [
        createTextChatMessage({
          role: "user",
          text: "Please inspect packages/gateway/src/modules/agent/runtime/preturn-hydration.ts",
        }),
      ],
      criticalIdentifiers: [
        "mcp.memory.seed",
        "packages/gateway/src/modules/agent/runtime/preturn-hydration.ts",
      ],
      relevantFiles: ["packages/gateway/src/modules/agent/runtime/preturn-hydration.ts"],
    });

    expect(instruction).toContain(
      "Do not invent facts, outcomes, commands, file paths, identifiers, or open questions",
    );
    expect(instruction).toContain(
      "Preserve commands, file paths, identifiers, and literal values verbatim",
    );
    expect(instruction).toContain("prefer the supported newer evidence");
  });
});
