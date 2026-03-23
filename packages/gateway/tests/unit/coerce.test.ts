/**
 * coerce.ts — unit tests for coercion utility functions.
 */

import { describe, expect, it } from "vitest";
import {
  coerceRecord,
  coerceString,
  readRecordString,
  coerceStringRecord,
  coerceNonEmptyStringRecord,
} from "../../src/modules/util/coerce.js";

describe("coerceRecord", () => {
  it("returns the object for a plain object", () => {
    const obj = { a: 1 };
    expect(coerceRecord(obj)).toBe(obj);
  });

  it("returns undefined for null", () => {
    expect(coerceRecord(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(coerceRecord(undefined)).toBeUndefined();
  });

  it("returns undefined for arrays", () => {
    expect(coerceRecord([1, 2, 3])).toBeUndefined();
  });

  it("returns undefined for strings", () => {
    expect(coerceRecord("string")).toBeUndefined();
  });

  it("returns undefined for numbers", () => {
    expect(coerceRecord(42)).toBeUndefined();
  });

  it("returns undefined for boolean false (falsy)", () => {
    expect(coerceRecord(false)).toBeUndefined();
  });

  it("returns undefined for zero (falsy)", () => {
    expect(coerceRecord(0)).toBeUndefined();
  });
});

describe("coerceString", () => {
  it("returns trimmed string for a valid string", () => {
    expect(coerceString("  hello  ")).toBe("hello");
  });

  it("returns undefined for empty string after trim", () => {
    expect(coerceString("   ")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(coerceString("")).toBeUndefined();
  });

  it("returns undefined for non-string types", () => {
    expect(coerceString(42)).toBeUndefined();
    expect(coerceString(null)).toBeUndefined();
    expect(coerceString(undefined)).toBeUndefined();
    expect(coerceString({})).toBeUndefined();
  });
});

describe("readRecordString", () => {
  it("reads a string value from a record", () => {
    expect(readRecordString({ name: "  alice  " }, "name")).toBe("alice");
  });

  it("returns undefined when key is missing", () => {
    expect(readRecordString({ name: "alice" }, "age")).toBeUndefined();
  });

  it("returns undefined when value is not a string", () => {
    expect(readRecordString({ count: 42 }, "count")).toBeUndefined();
  });

  it("returns undefined when input is not a record", () => {
    expect(readRecordString(null, "key")).toBeUndefined();
    expect(readRecordString("string", "key")).toBeUndefined();
  });
});

describe("coerceStringRecord", () => {
  it("extracts string values from a record", () => {
    expect(coerceStringRecord({ a: "1", b: "2", c: 3 })).toEqual({ a: "1", b: "2" });
  });

  it("returns undefined for non-object input", () => {
    expect(coerceStringRecord(null)).toBeUndefined();
    expect(coerceStringRecord("string")).toBeUndefined();
  });

  it("returns empty object when no values are strings", () => {
    expect(coerceStringRecord({ a: 1, b: true })).toEqual({});
  });
});

describe("coerceNonEmptyStringRecord", () => {
  it("extracts non-empty string key-value pairs", () => {
    expect(coerceNonEmptyStringRecord({ a: "1", b: "2" })).toEqual({ a: "1", b: "2" });
  });

  it("returns undefined for non-object input", () => {
    expect(coerceNonEmptyStringRecord(null)).toBeUndefined();
  });

  it("skips entries with non-string values", () => {
    expect(coerceNonEmptyStringRecord({ a: "1", b: 42 })).toEqual({ a: "1" });
  });

  it("skips entries with empty string values after trim", () => {
    expect(coerceNonEmptyStringRecord({ a: "valid", b: "   " })).toEqual({ a: "valid" });
  });

  it("returns empty object when all values are invalid", () => {
    expect(coerceNonEmptyStringRecord({ a: 1, b: null })).toEqual({});
  });
});
