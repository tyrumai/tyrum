import { describe, expect, it } from "vitest";
import { isSafeSuggestedOverridePattern } from "../../src/modules/policy/override-guardrails.js";

describe("isSafeSuggestedOverridePattern", () => {
  it("allows exact-match patterns", () => {
    expect(isSafeSuggestedOverridePattern("echo hi")).toBe(true);
  });

  it("allows a single trailing '*' prefix match", () => {
    expect(isSafeSuggestedOverridePattern("git status*")).toBe(true);
  });

  it("rejects patterns that include '?'", () => {
    expect(isSafeSuggestedOverridePattern("git status ?")).toBe(false);
  });

  it("rejects leading wildcards", () => {
    expect(isSafeSuggestedOverridePattern("*")).toBe(false);
    expect(isSafeSuggestedOverridePattern("*foo")).toBe(false);
  });

  it("rejects multiple wildcards or wildcards not at the end", () => {
    expect(isSafeSuggestedOverridePattern("git*status*")).toBe(false);
    expect(isSafeSuggestedOverridePattern("git* status")).toBe(false);
  });

  it("rejects patterns that look like shell globs (whitespace before trailing '*')", () => {
    expect(isSafeSuggestedOverridePattern("echo *")).toBe(false);
  });
});

