import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  join(__dirname, "../../migrations/postgres/133_guardian_reviews.sql"),
  "utf8",
);

describe("guardian review postgres migration", () => {
  it("guards paused_detail extraction against malformed context_json", () => {
    expect(migrationSql).toContain("pg_input_is_valid(context_json, 'jsonb')");
    expect(migrationSql).toMatch(
      /CASE\s+WHEN\s+pg_input_is_valid\(context_json, 'jsonb'\)\s+THEN\s+context_json::jsonb\s+ELSE\s+'\{\}'::jsonb\s+END\s*->>\s*'paused_detail'/s,
    );
  });
});
