import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MIGRATION_FILENAME_RENAMES } from "../../src/migration-renames.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = join(__dirname, "../../migrations");

function getMigrationFiles(kind: "sqlite" | "postgres"): string[] {
  return readdirSync(join(MIGRATIONS_ROOT, kind))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function getDuplicatePrefixes(files: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const prefix = file.split("_", 1)[0] ?? file;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([prefix]) => prefix)
    .sort();
}

describe("gateway migrations", () => {
  it("has no duplicate numeric prefixes (sqlite)", () => {
    const files = getMigrationFiles("sqlite");
    expect(getDuplicatePrefixes(files)).toEqual([]);
  });

  it("has no duplicate numeric prefixes (postgres)", () => {
    const files = getMigrationFiles("postgres");
    expect(getDuplicatePrefixes(files)).toEqual([]);
  });

  it("keeps sqlite and postgres migration filenames in sync", () => {
    const sqliteFiles = getMigrationFiles("sqlite");
    const postgresFiles = getMigrationFiles("postgres");
    expect(sqliteFiles).toEqual(postgresFiles);
  });

  it("keeps migration rename shim in sync with migration files", () => {
    const files = new Set(getMigrationFiles("sqlite"));
    const missingTo: string[] = [];
    const presentFrom: string[] = [];

    for (const [from, to] of MIGRATION_FILENAME_RENAMES) {
      if (!files.has(to)) missingTo.push(to);
      if (files.has(from)) presentFrom.push(from);
    }

    expect(missingTo).toEqual([]);
    expect(presentFrom).toEqual([]);
  });
});
