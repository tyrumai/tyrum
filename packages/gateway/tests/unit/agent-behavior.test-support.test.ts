import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import {
  extractPromptSection,
  extractPromptText,
  promptIncludes,
} from "./agent-behavior.test-support.js";

describe("agent behavior test support", () => {
  it("stops section extraction at the next prompt role boundary", () => {
    const promptText = extractPromptText({
      prompt: [
        {
          role: "system",
          content:
            "Conversation state:\nknown facts\n\nPre-turn recall (memory.seed):\nmy name is Ron",
        },
        { role: "user", content: "what is my name" },
      ],
    } as LanguageModelV3CallOptions);

    expect(promptIncludes(promptText, "what is my name")).toBe(true);
    expect(extractPromptSection(promptText, "Memory digest:")).toBe("my name is Ron");
    expect(extractPromptSection(promptText, "Memory digest:")).not.toContain("what is my name");
  });

  it("stops section extraction at the next prompt content part within one role", () => {
    const promptText = extractPromptText({
      prompt: [
        {
          role: "user",
          content: [
            { type: "text", text: "Pre-turn recall (memory.seed):\nmy name is Ron" },
            { type: "text", text: "what is my name" },
          ],
        },
      ],
    } as LanguageModelV3CallOptions);

    expect(promptIncludes(promptText, "what is my name")).toBe(true);
    expect(extractPromptSection(promptText, "Memory digest:")).toBe("my name is Ron");
    expect(extractPromptSection(promptText, "Memory digest:")).not.toContain("what is my name");
  });
});
