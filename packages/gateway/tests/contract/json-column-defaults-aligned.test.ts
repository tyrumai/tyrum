import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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
const postgresMigrationsDir = join(__dirname, "../../migrations/postgres");

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readSpecs(): JsonColumnSpec[] {
  return JSON.parse(readFileSync(specsPath, "utf8")) as JsonColumnSpec[];
}

function readPostgresMigrationsSql(): string {
  const files = readdirSync(postgresMigrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .toSorted();
  expect(files.length, "postgres migration files").toBeGreaterThan(0);
  return files.map((file) => readFileSync(join(postgresMigrationsDir, file), "utf-8")).join("\n\n");
}

function findCreateTableBlock(sql: string, table: string): string | null {
  const pattern = new RegExp(
    `CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${escapeRegex(table)}\\s*\\(([\\s\\S]*?)\\);`,
    "m",
  );
  const match = sql.match(pattern);
  return match ? (match[1] ?? null) : null;
}

function findAddColumnBlock(sql: string, table: string, column: string): string | null {
  const pattern = new RegExp(
    `ALTER\\s+TABLE\\s+${escapeRegex(table)}\\s+ADD\\s+COLUMN\\s+${escapeRegex(column)}\\b([\\s\\S]{0,240}?);`,
    "m",
  );
  const match = sql.match(pattern);
  return match ? (match[0] ?? null) : null;
}

describe("Postgres migrations", () => {
  it("keeps *_json column defaults aligned with canonical spec", () => {
    const specs = readSpecs().filter((s) => s.default !== null);
    expect(specs.length, "specs with defaults").toBeGreaterThan(0);

    const sql = readPostgresMigrationsSql();
    for (const spec of specs) {
      const createTableBlock = findCreateTableBlock(sql, spec.table);
      const block =
        createTableBlock && createTableBlock.includes(spec.column)
          ? createTableBlock
          : findAddColumnBlock(sql, spec.table, spec.column);
      expect(block, `missing column definition for ${spec.table}.${spec.column}`).toBeTruthy();
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
