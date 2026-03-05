import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = join(__dirname, "../../migrations");
const TARGET_SUFFIX = "_db_config_and_tokens_indexes.sql";

function findMigration(kind: "sqlite" | "postgres"): string {
  const matches = readdirSync(join(MIGRATIONS_ROOT, kind))
    .filter((file) => file.endsWith(TARGET_SUFFIX))
    .sort();
  expect(matches).toHaveLength(1);
  return matches[0] ?? "";
}

function extractIndexNames(sql: string): string[] {
  return [...sql.matchAll(/CREATE INDEX IF NOT EXISTS ([A-Za-z0-9_]+)/g)]
    .map((match) => match[1])
    .filter((name): name is string => Boolean(name))
    .sort();
}

describe("gateway migration indexes", () => {
  it("keeps sqlite and postgres index names in sync", () => {
    const sqliteMigration = findMigration("sqlite");
    const postgresMigration = findMigration("postgres");

    const sqliteSql = readFileSync(join(MIGRATIONS_ROOT, "sqlite", sqliteMigration), "utf-8");
    const postgresSql = readFileSync(join(MIGRATIONS_ROOT, "postgres", postgresMigration), "utf-8");

    expect(extractIndexNames(postgresSql)).toEqual(extractIndexNames(sqliteSql));
  });
});
