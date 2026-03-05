import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = join(__dirname, "../../migrations");

function tryGetTrackedMigrationFiles(
  migrationsRoot: string,
  kind: "sqlite" | "postgres",
): string[] | null {
  const dir = join(migrationsRoot, kind);
  try {
    const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (repoRoot.length === 0) return null;

    const relDir = relative(repoRoot, dir).replaceAll("\\", "/");
    const tracked = execFileSync("git", ["-C", repoRoot, "ls-files", "--", relDir], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    const files = tracked
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => basename(line))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    return files;
  } catch {
    return null;
  }
}

function getMigrationFiles(migrationsRoot: string, kind: "sqlite" | "postgres"): string[] {
  const tracked = tryGetTrackedMigrationFiles(migrationsRoot, kind);
  if (tracked) return tracked;

  return readdirSync(join(migrationsRoot, kind))
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
    const files = getMigrationFiles(MIGRATIONS_ROOT, "sqlite");
    expect(getDuplicatePrefixes(files)).toEqual([]);
  });

  it("has no duplicate numeric prefixes (postgres)", () => {
    const files = getMigrationFiles(MIGRATIONS_ROOT, "postgres");
    expect(getDuplicatePrefixes(files)).toEqual([]);
  });

  it("keeps sqlite and postgres migration filenames in sync", () => {
    const sqliteFiles = getMigrationFiles(MIGRATIONS_ROOT, "sqlite");
    const postgresFiles = getMigrationFiles(MIGRATIONS_ROOT, "postgres");
    expect(sqliteFiles).toEqual(postgresFiles);
  });

  it("ignores untracked migration files when checking duplicate prefixes", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "tyrum-migrations-"));
    try {
      execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });

      const migrationsRoot = join(repoRoot, "packages/gateway/migrations");
      const sqliteDir = join(migrationsRoot, "sqlite");
      mkdirSync(sqliteDir, { recursive: true });

      writeFileSync(join(sqliteDir, "100_a.sql"), "SELECT 1;", "utf-8");
      writeFileSync(join(sqliteDir, "102_tracked.sql"), "SELECT 1;", "utf-8");
      execFileSync("git", ["add", "."], { cwd: repoRoot, stdio: "ignore" });

      writeFileSync(join(sqliteDir, "102_untracked.sql"), "SELECT 1;", "utf-8");

      const files = getMigrationFiles(migrationsRoot, "sqlite");
      expect(getDuplicatePrefixes(files)).toEqual([]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
