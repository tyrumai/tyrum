import { describe, expect, it } from "vitest";
import { isPostgresDbUri } from "../../src/statestore/db-uri.js";
import { buildUpdatedAtMutation } from "../../src/statestore/updated-at.js";
import { sqlBoolParam, sqlActiveWhereClause } from "../../src/statestore/sql.js";

describe("isPostgresDbUri", () => {
  it("returns true for postgres:// URIs", () => {
    expect(isPostgresDbUri("postgres://localhost:5432/db")).toBe(true);
  });

  it("returns true for postgresql:// URIs", () => {
    expect(isPostgresDbUri("postgresql://localhost:5432/db")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isPostgresDbUri("POSTGRES://localhost/db")).toBe(true);
    expect(isPostgresDbUri("PostgreSQL://localhost/db")).toBe(true);
  });

  it("trims whitespace", () => {
    expect(isPostgresDbUri("  postgres://localhost/db  ")).toBe(true);
  });

  it("returns false for SQLite paths", () => {
    expect(isPostgresDbUri("/path/to/db.sqlite")).toBe(false);
    expect(isPostgresDbUri("data.db")).toBe(false);
  });

  it("returns false for empty strings", () => {
    expect(isPostgresDbUri("")).toBe(false);
  });
});

describe("buildUpdatedAtMutation", () => {
  const updatedAt = "2026-01-01T00:00:00Z";

  it("returns undefined when no fields changed", () => {
    const fields = [{ column: "name", currentValue: "Alice", nextValue: "Alice" }];
    expect(buildUpdatedAtMutation(fields, updatedAt)).toBeUndefined();
  });

  it("returns mutation when a field changed", () => {
    const fields = [{ column: "name", currentValue: "Alice", nextValue: "Bob" }];
    const result = buildUpdatedAtMutation(fields, updatedAt);
    expect(result).toBeDefined();
    expect(result!.assignments).toEqual(["name = ?", "updated_at = ?"]);
    expect(result!.values).toEqual(["Bob", updatedAt]);
  });

  it("includes all changed fields", () => {
    const fields = [
      { column: "name", currentValue: "Alice", nextValue: "Bob" },
      { column: "age", currentValue: 30, nextValue: 31 },
      { column: "email", currentValue: "a@b.com", nextValue: "a@b.com" },
    ];
    const result = buildUpdatedAtMutation(fields, updatedAt);
    expect(result).toBeDefined();
    expect(result!.assignments).toEqual(["name = ?", "age = ?", "updated_at = ?"]);
    expect(result!.values).toEqual(["Bob", 31, updatedAt]);
  });

  it("returns undefined for empty fields array", () => {
    expect(buildUpdatedAtMutation([], updatedAt)).toBeUndefined();
  });

  it("uses Object.is for comparison (handles NaN)", () => {
    const fields = [{ column: "score", currentValue: NaN, nextValue: NaN }];
    expect(buildUpdatedAtMutation(fields, updatedAt)).toBeUndefined();
  });
});

describe("sqlBoolParam", () => {
  it("returns boolean for postgres", () => {
    expect(sqlBoolParam({ kind: "postgres" }, true)).toBe(true);
    expect(sqlBoolParam({ kind: "postgres" }, false)).toBe(false);
  });

  it("returns 1/0 for sqlite", () => {
    expect(sqlBoolParam({ kind: "sqlite" }, true)).toBe(1);
    expect(sqlBoolParam({ kind: "sqlite" }, false)).toBe(0);
  });
});

describe("sqlActiveWhereClause", () => {
  it("uses 'active' as default column", () => {
    const result = sqlActiveWhereClause({ kind: "sqlite" });
    expect(result.sql).toBe("active = ?");
    expect(result.params).toEqual([1]);
  });

  it("uses custom column name", () => {
    const result = sqlActiveWhereClause({ kind: "sqlite" }, { column: "is_enabled" });
    expect(result.sql).toBe("is_enabled = ?");
    expect(result.params).toEqual([1]);
  });

  it("uses boolean params for postgres", () => {
    const result = sqlActiveWhereClause({ kind: "postgres" });
    expect(result.params).toEqual([true]);
  });

  it("falls back to 'active' when column is empty", () => {
    const result = sqlActiveWhereClause({ kind: "sqlite" }, { column: "  " });
    expect(result.sql).toBe("active = ?");
  });
});
