/**
 * db-uri.ts — unit tests for database URI detection.
 */

import { describe, expect, it } from "vitest";
import { isPostgresDbUri } from "../../src/statestore/db-uri.js";

describe("isPostgresDbUri", () => {
  it("returns true for postgres:// URIs", () => {
    expect(isPostgresDbUri("postgres://localhost:5432/db")).toBe(true);
  });

  it("returns true for postgresql:// URIs", () => {
    expect(isPostgresDbUri("postgresql://localhost:5432/db")).toBe(true);
  });

  it("returns true for case-insensitive postgres URIs", () => {
    expect(isPostgresDbUri("POSTGRES://host/db")).toBe(true);
    expect(isPostgresDbUri("PostgreSQL://host/db")).toBe(true);
  });

  it("trims whitespace before checking", () => {
    expect(isPostgresDbUri("  postgres://host/db  ")).toBe(true);
  });

  it("returns false for SQLite file paths", () => {
    expect(isPostgresDbUri("/path/to/database.db")).toBe(false);
  });

  it("returns false for :memory: path", () => {
    expect(isPostgresDbUri(":memory:")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isPostgresDbUri("")).toBe(false);
  });

  it("returns false for http URIs", () => {
    expect(isPostgresDbUri("http://localhost")).toBe(false);
  });
});
