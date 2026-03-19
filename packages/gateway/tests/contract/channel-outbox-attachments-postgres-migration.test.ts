import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newDb } from "pg-mem";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(__dirname, "../../migrations/postgres/145_channel_outbox_attachments_constraints.sql"),
  "utf8",
);

describe("channel outbox attachments postgres migration", () => {
  it("backfills null rows and enforces a non-null default", () => {
    const mem = newDb();

    mem.public.none(`
      CREATE TABLE channel_outbox (
        outbox_id INTEGER PRIMARY KEY,
        attachments_json TEXT
      );

      INSERT INTO channel_outbox (outbox_id, attachments_json) VALUES
        (1, NULL);
    `);

    expect(() => mem.public.none(migrationSql)).not.toThrow();

    expect(
      mem.public.one<{ attachments_json: string }>(
        "SELECT attachments_json FROM channel_outbox WHERE outbox_id = 1",
      ),
    ).toEqual({ attachments_json: "[]" });

    expect(() =>
      mem.public.none("INSERT INTO channel_outbox (outbox_id) VALUES (2)"),
    ).not.toThrow();
    expect(
      mem.public.one<{ attachments_json: string }>(
        "SELECT attachments_json FROM channel_outbox WHERE outbox_id = 2",
      ),
    ).toEqual({ attachments_json: "[]" });

    expect(() =>
      mem.public.none("INSERT INTO channel_outbox (outbox_id, attachments_json) VALUES (3, NULL)"),
    ).toThrow();
  });
});
