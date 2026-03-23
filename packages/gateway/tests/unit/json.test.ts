import { describe, expect, it } from "vitest";
import { safeJsonParse } from "../../src/utils/json.js";

describe("safeJsonParse", () => {
  it("returns fallback when JSON is malformed", () => {
    expect(safeJsonParse("{", { ok: true })).toEqual({ ok: true });
  });

  it("returns fallback when JSON parses to the wrong shape", () => {
    expect(safeJsonParse("{}", [] as unknown[])).toEqual([]);
    expect(safeJsonParse("[]", {} as Record<string, unknown>)).toEqual({});
  });

  it("returns fallback for null input", () => {
    expect(safeJsonParse(null, "default")).toBe("default");
  });

  it("returns fallback for undefined input", () => {
    expect(safeJsonParse(undefined, 42)).toBe(42);
  });

  it("returns fallback for empty string input", () => {
    expect(safeJsonParse("", "fallback")).toBe("fallback");
  });

  it("returns parsed value when fallback is null", () => {
    expect(safeJsonParse('{"a":1}', null)).toEqual({ a: 1 });
  });

  it("returns parsed value when fallback is undefined", () => {
    expect(safeJsonParse('"hello"', undefined)).toBe("hello");
  });

  it("returns parsed array when fallback is an array", () => {
    expect(safeJsonParse("[1,2,3]", [] as number[])).toEqual([1, 2, 3]);
  });

  it("returns fallback array when parsed value is not an array", () => {
    expect(safeJsonParse('"not an array"', [1, 2])).toEqual([1, 2]);
  });

  it("returns parsed object when fallback is an object", () => {
    expect(safeJsonParse('{"x":1}', {} as Record<string, unknown>)).toEqual({ x: 1 });
  });

  it("returns fallback object when parsed value is null", () => {
    expect(safeJsonParse("null", { x: 1 })).toEqual({ x: 1 });
  });

  it("returns fallback object when parsed value is an array", () => {
    expect(safeJsonParse("[1]", { x: 1 })).toEqual({ x: 1 });
  });

  it("returns parsed primitive when fallback type matches", () => {
    expect(safeJsonParse("42", 0)).toBe(42);
    expect(safeJsonParse('"hello"', "")).toBe("hello");
    expect(safeJsonParse("true", false)).toBe(true);
  });

  it("returns fallback when parsed primitive type does not match", () => {
    expect(safeJsonParse('"string"', 0)).toBe(0);
    expect(safeJsonParse("42", "default")).toBe("default");
  });
});
