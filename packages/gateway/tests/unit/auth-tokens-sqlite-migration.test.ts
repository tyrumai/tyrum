import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(__dirname, "../../migrations/sqlite/127_auth_tokens_display_name_updated_at.sql"),
  "utf8",
);

describe("sqlite auth token migration", () => {
  it("backfills updated_at for populated auth_tokens tables", () => {
    const sqlite = createDatabase(":memory:");
    try {
      sqlite.exec(`
        CREATE TABLE auth_tokens (
          token_id TEXT PRIMARY KEY,
          role TEXT NOT NULL,
          device_id TEXT,
          created_at TEXT NOT NULL
        );
      `);

      sqlite
        .prepare(
          "INSERT INTO auth_tokens (token_id, role, device_id, created_at) VALUES (?, ?, ?, ?)",
        )
        .run("token-1", "node", "desktop-node-1", "2026-03-11T12:00:00.000Z");

      expect(() => sqlite.exec(migrationSql)).not.toThrow();

      const row = sqlite
        .prepare("SELECT display_name, updated_at FROM auth_tokens WHERE token_id = ?")
        .get("token-1") as { display_name: string; updated_at: string };

      expect(row.display_name).toBe("desktop-node-1");
      expect(row.updated_at).toBe("2026-03-11T12:00:00.000Z");
    } finally {
      sqlite.close();
    }
  });
});
