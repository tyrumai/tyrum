import { describe, expect, it, vi } from "vitest";
import { PostgresDb } from "../../src/statestore/postgres.js";

describe("PostgresDb placeholder translation", () => {
  it("translates ? placeholders for SQL used by countByStatus", async () => {
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      expect(sql).not.toContain("?");
      expect(sql).toMatch(/WHERE status IN \(\$1, \$2, \$3\)/);
      expect(params).toEqual(["queued", "running", "paused"]);
      return { rows: [] };
    });

    const client = { query };
    const DbCtor = PostgresDb as unknown as new (opts: { client: typeof client }) => PostgresDb;
    const db = new DbCtor({ client });

    await db.all(
      `SELECT status, COUNT(*) AS count
       FROM turns
       WHERE status IN (?, ?, ?)
       GROUP BY status`,
      ["queued", "running", "paused"],
    );

    expect(query).toHaveBeenCalledOnce();
  });
});
