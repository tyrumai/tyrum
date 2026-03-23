import { describe, expect, it } from "vitest";
import { isMissingTableError } from "../../src/modules/observability/db-errors.js";

describe("isMissingTableError", () => {
  it("returns false for null", () => {
    expect(isMissingTableError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isMissingTableError(undefined)).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(isMissingTableError("not an error")).toBe(false);
    expect(isMissingTableError(42)).toBe(false);
    expect(isMissingTableError(true)).toBe(false);
  });

  it("returns true for Postgres code 42P01 (undefined table)", () => {
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
  });

  it("returns false for other Postgres error codes", () => {
    expect(isMissingTableError({ code: "23505" })).toBe(false);
  });

  it("returns true for SQLite 'no such table' message", () => {
    expect(isMissingTableError({ message: "no such table: memory_items" })).toBe(true);
    expect(isMissingTableError({ message: "NO SUCH TABLE: memory_items" })).toBe(true);
  });

  it("returns true for Postgres 'relation does not exist' message", () => {
    expect(isMissingTableError({ message: 'relation "memory_items" does not exist' })).toBe(true);
  });

  it("returns false when message is not a string", () => {
    expect(isMissingTableError({ message: 123 })).toBe(false);
  });

  it("returns false for unrelated error messages", () => {
    expect(isMissingTableError({ message: "connection refused" })).toBe(false);
  });

  it("returns false for empty object", () => {
    expect(isMissingTableError({})).toBe(false);
  });

  it("returns false for zero (falsy non-null/undefined)", () => {
    expect(isMissingTableError(0)).toBe(false);
  });
});
