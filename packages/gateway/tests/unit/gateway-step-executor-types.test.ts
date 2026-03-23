import { describe, expect, it } from "vitest";
import {
  parseProviderModelId,
  maybeTruncateText,
  deriveAgentKeyFromKey,
  deriveAgentIdFromKey,
  extractToolErrorMessage,
} from "../../src/modules/execution/gateway-step-executor-types.js";

describe("parseProviderModelId", () => {
  it("parses a valid provider/model string", () => {
    expect(parseProviderModelId("openai/gpt-4")).toEqual({
      providerId: "openai",
      modelId: "gpt-4",
    });
  });

  it("trims whitespace", () => {
    expect(parseProviderModelId("  anthropic/claude-3  ")).toEqual({
      providerId: "anthropic",
      modelId: "claude-3",
    });
  });

  it("throws for string without a slash", () => {
    expect(() => parseProviderModelId("gpt-4")).toThrow("invalid model");
  });

  it("throws for string with only a leading slash", () => {
    expect(() => parseProviderModelId("/model")).toThrow("invalid model");
  });

  it("throws for string with only a trailing slash", () => {
    expect(() => parseProviderModelId("provider/")).toThrow("invalid model");
  });
});

describe("maybeTruncateText", () => {
  it("returns empty text and truncated=true when maxBytes is 0", () => {
    expect(maybeTruncateText("hello", 0)).toEqual({ text: "", truncated: true });
  });

  it("returns empty text and truncated=true when maxBytes is negative", () => {
    expect(maybeTruncateText("hello", -1)).toEqual({ text: "", truncated: true });
  });

  it("returns the full text when it fits within maxBytes", () => {
    expect(maybeTruncateText("hello", 100)).toEqual({ text: "hello", truncated: false });
  });

  it("returns the full text when byte length equals maxBytes", () => {
    expect(maybeTruncateText("hello", 5)).toEqual({ text: "hello", truncated: false });
  });

  it("truncates text that exceeds maxBytes", () => {
    const result = maybeTruncateText("hello world", 5);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("hello");
  });

  it("handles multi-byte characters gracefully", () => {
    const emoji = "Hello \u{1F600}"; // 4-byte emoji
    const result = maybeTruncateText(emoji, 7);
    expect(result.truncated).toBe(true);
    // Should not produce invalid UTF-8
    expect(typeof result.text).toBe("string");
  });
});

describe("deriveAgentKeyFromKey", () => {
  it("extracts agent key from agent:key:... format", () => {
    expect(deriveAgentKeyFromKey("agent:myagent:telegram:ws1:dm:thread1")).toBe("myagent");
  });

  it("returns 'default' when key does not start with agent:", () => {
    expect(deriveAgentKeyFromKey("some:other:key")).toBe("default");
  });

  it("returns 'default' when agent key part is empty", () => {
    expect(deriveAgentKeyFromKey("agent:")).toBe("default");
    expect(deriveAgentKeyFromKey("agent:  ")).toBe("default");
  });

  it("is aliased as deriveAgentIdFromKey", () => {
    expect(deriveAgentIdFromKey).toBe(deriveAgentKeyFromKey);
  });
});

describe("extractToolErrorMessage", () => {
  it("returns Error message for Error instances", () => {
    expect(extractToolErrorMessage(new Error("something failed"))).toBe("something failed");
  });

  it("returns the string directly for string errors", () => {
    expect(extractToolErrorMessage("string error")).toBe("string error");
  });

  it("returns JSON representation for other values", () => {
    expect(extractToolErrorMessage({ code: 42 })).toBe('{"code":42}');
  });

  it("returns String() for values that can't be JSON serialized", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const result = extractToolErrorMessage(circular);
    expect(typeof result).toBe("string");
  });

  it("returns JSON null for null", () => {
    expect(extractToolErrorMessage(null)).toBe("null");
  });

  it("returns JSON representation for numbers", () => {
    expect(extractToolErrorMessage(42)).toBe("42");
  });

  it("returns empty string trimmed correctly for whitespace-only string", () => {
    // whitespace-only string has trim().length === 0, falls through to JSON.stringify
    expect(extractToolErrorMessage("   ")).toBe('"   "');
  });
});
