import { describe, expect, it } from "vitest";
import { normalizePositiveInt } from "../../src/modules/execution/normalize-positive-int.js";

describe("normalizePositiveInt", () => {
  it("returns floored positive integers", () => {
    expect(normalizePositiveInt(1)).toBe(1);
    expect(normalizePositiveInt(1.9)).toBe(1);
    expect(normalizePositiveInt(10_000.1)).toBe(10_000);
  });

  it("returns undefined for non-numbers, non-finite numbers, and non-positive values", () => {
    expect(normalizePositiveInt(undefined)).toBeUndefined();
    expect(normalizePositiveInt("5")).toBeUndefined();
    expect(normalizePositiveInt(Number.NaN)).toBeUndefined();
    expect(normalizePositiveInt(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(normalizePositiveInt(0)).toBeUndefined();
    expect(normalizePositiveInt(-1)).toBeUndefined();
    expect(normalizePositiveInt(-2.7)).toBeUndefined();
  });
});
