import { describe, expect, it } from "vitest";
import { normalizeProviderScopedModelId } from "../../src/modules/models/provider-model-id.js";

describe("normalizeProviderScopedModelId", () => {
  it("strips redundant provider prefix from model id", () => {
    expect(normalizeProviderScopedModelId("openai", "openai/gpt-4")).toBe("gpt-4");
  });

  it("returns model id unchanged when provider prefix doesn't match", () => {
    expect(normalizeProviderScopedModelId("anthropic", "openai/gpt-4")).toBe("openai/gpt-4");
  });

  it("returns model id unchanged when it doesn't start with provider/", () => {
    expect(normalizeProviderScopedModelId("openai", "gpt-4")).toBe("gpt-4");
  });

  it("trims whitespace from inputs", () => {
    expect(normalizeProviderScopedModelId("  openai  ", "  openai/gpt-4  ")).toBe("gpt-4");
  });

  it("returns model id when provider id is empty", () => {
    expect(normalizeProviderScopedModelId("", "gpt-4")).toBe("gpt-4");
  });

  it("returns model id when it is empty", () => {
    expect(normalizeProviderScopedModelId("openai", "")).toBe("");
  });

  it("handles both empty provider and model", () => {
    expect(normalizeProviderScopedModelId("", "")).toBe("");
  });
});
