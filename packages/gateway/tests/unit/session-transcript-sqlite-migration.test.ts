import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(__dirname, "../../migrations/sqlite/122_session_transcript_v1.sql"),
  "utf8",
);

describe("sqlite session transcript migration", () => {
  it("only rewrites legacy turn arrays and leaves non-array JSON untouched", () => {
    const sqlite = createDatabase(":memory:");
    try {
      sqlite.exec(`
        CREATE TABLE sessions (
          session_id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          turns_json TEXT NOT NULL
        );
      `);

      sqlite
        .prepare("INSERT INTO sessions (session_id, created_at, turns_json) VALUES (?, ?, ?)")
        .run(
          "array-row",
          "2026-01-01T00:00:00.000Z",
          JSON.stringify([{ role: "assistant", content: "hello" }]),
        );
      sqlite
        .prepare("INSERT INTO sessions (session_id, created_at, turns_json) VALUES (?, ?, ?)")
        .run(
          "object-row",
          "2026-01-01T00:00:00.000Z",
          JSON.stringify({ role: "assistant", content: "hello" }),
        );

      sqlite.exec(migrationSql);

      const migratedArray = sqlite
        .prepare("SELECT turns_json FROM sessions WHERE session_id = ?")
        .get("array-row") as { turns_json: string };
      const untouchedObject = sqlite
        .prepare("SELECT turns_json FROM sessions WHERE session_id = ?")
        .get("object-row") as { turns_json: string };

      expect(JSON.parse(migratedArray.turns_json)).toEqual([
        expect.objectContaining({
          kind: "text",
          role: "assistant",
          content: "hello",
          created_at: "2026-01-01T00:00:00.000Z",
        }),
      ]);
      expect(JSON.parse(untouchedObject.turns_json)).toEqual({
        role: "assistant",
        content: "hello",
      });
    } finally {
      sqlite.close();
    }
  });
});
