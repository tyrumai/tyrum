import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";

type JsonColumnShape = "array" | "object" | "any";

type JsonColumnSpec = {
  table: string;
  column: string;
  shape: JsonColumnShape;
  nullable: boolean;
  default: string | null;
};

type SqliteColumnInfo = {
  name: string;
  notnull: 0 | 1;
  dflt_value: string | null;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqliteMigrationsDir = join(__dirname, "../../migrations/sqlite");
const specsPath = join(__dirname, "../../src/statestore/json-columns.json");

function listSqliteJsonColumns(db: ReturnType<typeof createDatabase>) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => (r as { name: string }).name)
    .filter((t) => !t.startsWith("sqlite_") && t !== "_migrations");

  const columns: Array<{ table: string; column: string; info: SqliteColumnInfo }> = [];
  for (const table of tables) {
    const infos = db.prepare(`PRAGMA table_info(${table})`).all() as SqliteColumnInfo[];
    for (const info of infos) {
      if (info.name.endsWith("_json")) {
        columns.push({ table, column: info.name, info });
      }
    }
  }
  columns.sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column));
  return columns;
}

function parseJsonDefault(value: string): unknown {
  return JSON.parse(value) as unknown;
}

describe("StateStore JSON column specs", () => {
  it("documents canonical shapes/defaults for all *_json columns", () => {
    const sqlite = createDatabase(":memory:");
    try {
      migrate(sqlite, sqliteMigrationsDir);

      let rawSpecs: string | null = null;
      try {
        rawSpecs = readFileSync(specsPath, "utf8");
      } catch {
        // assertion below
      }

      expect(rawSpecs, `Missing JSON column specs file: ${specsPath}`).toBeTruthy();
      if (!rawSpecs) return;

      const specs = JSON.parse(rawSpecs) as JsonColumnSpec[];
      expect(Array.isArray(specs), "specs is an array").toBe(true);
      expect(specs.length, "specs has entries").toBeGreaterThan(0);

      const specKeys = new Set<string>();
      const specByKey = new Map<string, JsonColumnSpec>();
      for (const spec of specs) {
        const key = `${spec.table}.${spec.column}`;
        expect(specKeys.has(key), `duplicate spec entry for ${key}`).toBe(false);
        specKeys.add(key);
        specByKey.set(key, spec);

        expect(spec.column.endsWith("_json"), `${key} is a *_json column`).toBe(true);
        expect(spec.shape === "array" || spec.shape === "object" || spec.shape === "any").toBe(
          true,
        );
        expect(typeof spec.nullable).toBe("boolean");
        expect(
          spec.default === null ||
            (() => {
              try {
                parseJsonDefault(spec.default);
                return true;
              } catch {
                return false;
              }
            })(),
        ).toBe(true);
        if (spec.default !== null) {
          const parsedDefault = parseJsonDefault(spec.default);
          if (spec.shape === "array") expect(Array.isArray(parsedDefault)).toBe(true);
          if (spec.shape === "object") {
            expect(
              parsedDefault && typeof parsedDefault === "object" && !Array.isArray(parsedDefault),
            ).toBe(true);
          }
        }
      }

      const sqliteJsonCols = listSqliteJsonColumns(sqlite);
      expect(sqliteJsonCols.length, "sqlite has *_json columns").toBeGreaterThan(0);
      for (const { table, column, info } of sqliteJsonCols) {
        const key = `${table}.${column}`;
        const spec = specByKey.get(key);
        expect(spec, `missing spec entry for ${key}`).toBeTruthy();
        if (!spec) continue;

        expect(info.notnull === 1, `${key} nullability`).toBe(!spec.nullable);
        const expectedDefault = spec.default === null ? null : `'${spec.default}'`;
        expect(info.dflt_value, `${key} default`).toBe(expectedDefault);
      }

      for (const spec of specs) {
        const key = `${spec.table}.${spec.column}`;
        const match = sqliteJsonCols.find((c) => `${c.table}.${c.column}` === key);
        expect(match, `spec entry ${key} must exist in sqlite schema`).toBeTruthy();
      }
    } finally {
      sqlite.close();
    }
  });
});
