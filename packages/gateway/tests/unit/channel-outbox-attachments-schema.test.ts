import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = join(__dirname, "../../migrations");

function readMigration(kind: "sqlite" | "postgres", name: string): string {
  return readFileSync(join(MIGRATIONS_ROOT, kind, name), "utf-8");
}

describe("channel outbox attachments schema", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("keeps the rebuild v2 channel_outbox schema aligned with attachments_json", () => {
    const expectedColumn = /attachments_json\s+TEXT NOT NULL DEFAULT '\[\]'/;

    expect(readMigration("sqlite", "100_rebuild_v2.sql")).toMatch(expectedColumn);
    expect(readMigration("postgres", "100_rebuild_v2.sql")).toMatch(expectedColumn);
  });

  it("applies sqlite migrations with a non-null defaulted attachments_json column", async () => {
    db = openTestSqliteDb();

    const columns = await db.all<{
      name: string;
      notnull: number;
      dflt_value: string | null;
    }>("PRAGMA table_info(channel_outbox)");
    const attachmentsColumn = columns.find((column) => column.name === "attachments_json");

    expect(attachmentsColumn).toMatchObject({
      name: "attachments_json",
      notnull: 1,
      dflt_value: "'[]'",
    });
  });
});
