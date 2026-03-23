/**
 * config-key-utils.ts — unit tests for route key utility functions.
 */

import { describe, expect, it } from "vitest";
import {
  slugifyKey,
  createUniqueKey,
  normalizeAgentKey,
} from "../../src/routes/config-key-utils.js";

describe("slugifyKey", () => {
  it("lowercases and replaces non-alphanumeric characters with hyphens", () => {
    expect(slugifyKey("Hello World!", "fallback")).toBe("hello-world");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugifyKey("--test--", "fallback")).toBe("test");
  });

  it("returns the fallback when input normalises to empty", () => {
    expect(slugifyKey("!!!", "my-fallback")).toBe("my-fallback");
  });

  it("returns the fallback for whitespace-only input", () => {
    expect(slugifyKey("   ", "fb")).toBe("fb");
  });

  it("truncates to 64 characters", () => {
    const long = "a".repeat(100);
    expect(slugifyKey(long, "fb").length).toBeLessThanOrEqual(64);
  });

  it("collapses consecutive special characters into a single hyphen", () => {
    expect(slugifyKey("a---b___c", "fb")).toBe("a-b-c");
  });
});

describe("createUniqueKey", () => {
  it("returns the base key when it does not exist", () => {
    expect(createUniqueKey("my-key", new Set())).toBe("my-key");
  });

  it("appends a numeric suffix when the base already exists", () => {
    expect(createUniqueKey("my-key", new Set(["my-key"]))).toBe("my-key-2");
  });

  it("increments the suffix until a free slot is found", () => {
    const existing = new Set(["my-key", "my-key-2", "my-key-3"]);
    expect(createUniqueKey("my-key", existing)).toBe("my-key-4");
  });

  it("falls back to a UUID-based suffix when all numeric slots (2-999) are taken", () => {
    const existing = new Set<string>();
    existing.add("k");
    for (let i = 2; i <= 999; i += 1) {
      existing.add(`k-${String(i)}`);
    }
    const result = createUniqueKey("k", existing);
    expect(result).toMatch(/^k-[a-f0-9]{8}$/);
    expect(existing.has(result)).toBe(false);
  });
});

describe("normalizeAgentKey", () => {
  it("returns 'default' for empty input", () => {
    expect(normalizeAgentKey("")).toBe("default");
  });

  it("returns 'default' for whitespace-only input", () => {
    expect(normalizeAgentKey("   ")).toBe("default");
  });

  it("passes through a valid agent key", () => {
    expect(normalizeAgentKey("my-agent")).toBe("my-agent");
  });

  it("trims whitespace from valid keys", () => {
    expect(normalizeAgentKey("  my-agent  ")).toBe("my-agent");
  });

  it("throws for agent keys containing colons", () => {
    // AgentKey regex rejects ':' characters
    expect(() => normalizeAgentKey("invalid:key")).toThrow(/invalid agent_key/);
  });
});
