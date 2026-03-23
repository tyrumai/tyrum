/**
 * app-path.ts — unit tests for path prefix matching.
 */

import { describe, expect, it } from "vitest";
import { matchesPathPrefixSegment } from "../../src/app-path.js";

describe("matchesPathPrefixSegment", () => {
  it("returns true when pathname equals prefix exactly", () => {
    expect(matchesPathPrefixSegment("/api", "/api")).toBe(true);
  });

  it("returns true when pathname starts with prefix followed by /", () => {
    expect(matchesPathPrefixSegment("/api/users", "/api")).toBe(true);
  });

  it("returns false when pathname starts with prefix but not at segment boundary", () => {
    expect(matchesPathPrefixSegment("/apikeys", "/api")).toBe(false);
  });

  it("returns false when pathname does not match prefix", () => {
    expect(matchesPathPrefixSegment("/other", "/api")).toBe(false);
  });

  it("returns true for root prefix", () => {
    expect(matchesPathPrefixSegment("/", "/")).toBe(true);
  });

  it("returns true for root prefix with nested path", () => {
    expect(matchesPathPrefixSegment("//nested", "/")).toBe(true);
  });
});
