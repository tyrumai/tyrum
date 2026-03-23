/**
 * secure-string-equal.ts — unit tests for timing-safe string comparison.
 */

import { describe, expect, it } from "vitest";
import { secureStringEqual } from "../../src/utils/secure-string-equal.js";

describe("secureStringEqual", () => {
  it("returns true for identical strings", () => {
    expect(secureStringEqual("hello", "hello")).toBe(true);
  });

  it("returns false for strings with different lengths", () => {
    expect(secureStringEqual("short", "much longer string")).toBe(false);
  });

  it("returns false for same-length but different strings", () => {
    expect(secureStringEqual("abcde", "abcdf")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(secureStringEqual("", "")).toBe(true);
  });

  it("returns false when one string is empty and the other is not", () => {
    expect(secureStringEqual("", "x")).toBe(false);
  });

  it("handles unicode strings", () => {
    expect(secureStringEqual("caf\u00e9", "caf\u00e9")).toBe(true);
    expect(secureStringEqual("caf\u00e9", "cafe")).toBe(false);
  });
});
