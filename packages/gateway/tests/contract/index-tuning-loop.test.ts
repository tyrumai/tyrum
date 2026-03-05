import { describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("index tuning loop", () => {
  it("uses an index for outbox ordering by inbox_id (sqlite)", async () => {
    const db = openTestSqliteDb();
    try {
      await db.exec("PRAGMA automatic_index = OFF");

      const rows = await db.all<{ detail: string }>(
        `EXPLAIN QUERY PLAN
         SELECT outbox_id
         FROM channel_outbox
         WHERE inbox_id = ?
         ORDER BY chunk_index ASC, outbox_id ASC
         LIMIT 1`,
        [1],
      );

      const details = rows.map((r) => r.detail).join("\n");
      expect(details).toContain("channel_outbox_inbox_chunk_outbox_idx");
    } finally {
      await db.close();
    }
  });
});
