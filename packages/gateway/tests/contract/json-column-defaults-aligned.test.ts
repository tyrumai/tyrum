import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type JsonColumnShape = "array" | "object" | "any";

type JsonColumnSpec = {
  table: string;
  column: string;
  shape: JsonColumnShape;
  nullable: boolean;
  default: "{}" | "[]" | null;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const specsPath = join(__dirname, "../../src/statestore/json-columns.json");
const postgresRebuildPath = join(__dirname, "../../migrations/postgres/100_rebuild_v2.sql");

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readSpecs(): JsonColumnSpec[] {
  return JSON.parse(readFileSync(specsPath, "utf8")) as JsonColumnSpec[];
}

function findCreateTableBlock(sql: string, table: string): string | null {
  const pattern = new RegExp(
    `CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${escapeRegex(table)}\\s*\\(([\\s\\S]*?)\\);`,
    "m",
  );
  const match = sql.match(pattern);
  return match ? (match[1] ?? null) : null;
}

describe("Postgres migrations", () => {
  it("keeps *_json column defaults aligned with canonical spec", () => {
    const specs = readSpecs().filter((s) => s.default !== null);
    expect(specs.length, "specs with defaults").toBeGreaterThan(0);

    const sql = readFileSync(postgresRebuildPath, "utf8");
    for (const spec of specs) {
      const block = findCreateTableBlock(sql, spec.table);
      expect(block, `missing CREATE TABLE block for ${spec.table}`).toBeTruthy();
      if (!block) continue;

      const defaultValue = spec.default;
      const colPattern = new RegExp(
        `\\b${escapeRegex(spec.column)}\\b[\\s\\S]{0,200}?DEFAULT\\s+'${escapeRegex(defaultValue)}'`,
        "m",
      );
      expect(block, `${spec.table}.${spec.column} default`).toMatch(colPattern);
    }
  });
});
