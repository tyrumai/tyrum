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
          content: "Session context:\nknown facts\n\nMemory digest:\nmy name is Ron",
        },
        { role: "user", content: "what is my name" },
      ],
    } as LanguageModelV3CallOptions);

    expect(promptIncludes(promptText, "what is my name")).toBe(true);
    expect(extractPromptSection(promptText, "Memory digest:")).toBe("my name is Ron");
    expect(extractPromptSection(promptText, "Memory digest:")).not.toContain("what is my name");
  });
});
