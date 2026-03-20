import { describe, expect, it } from "vitest";
import { wildcardMatch } from "@tyrum/runtime-policy";

describe("runtime-policy wildcard matching", () => {
  it("matches exact strings", () => {
    expect(wildcardMatch("echo hi", "echo hi")).toBe(true);
  });

  it("supports single-character matches with '?'", () => {
    expect(wildcardMatch("file-?.txt", "file-a.txt")).toBe(true);
    expect(wildcardMatch("file-?.txt", "file-ab.txt")).toBe(false);
  });

  it("supports '*' backtracking in the middle of a pattern", () => {
    expect(wildcardMatch("ab*cd", "abXYZcd")).toBe(true);
  });

  it("returns false when no wildcard path matches", () => {
    expect(wildcardMatch("ab*cd", "abXYZef")).toBe(false);
  });

  it("consumes trailing '*' after input end", () => {
    expect(wildcardMatch("status*", "status")).toBe(true);
  });
});
