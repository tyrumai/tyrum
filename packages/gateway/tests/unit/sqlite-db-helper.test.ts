import { describe, expect, it, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { SqliteDb } from "../../src/statestore/sqlite.js";

describe("openTestSqliteDb", () => {
  it("fails fast with remediation and preserves the root cause when DB setup fails", () => {
    const root = new Error("native binding load failed");
    const spy = vi.spyOn(SqliteDb, "open").mockImplementation(() => {
      throw root;
    });

    try {
      let thrown: unknown;
      try {
        openTestSqliteDb();
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toMatch(/Failed to open SQLite test database/);
      expect((thrown as Error).cause).toBe(root);
    } finally {
      spy.mockRestore();
    }
  });
});
