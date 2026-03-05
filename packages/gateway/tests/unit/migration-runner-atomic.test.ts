import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../../src/db.js";
import { migratePostgres } from "../../src/migrate-postgres.js";
import { migrate } from "../../src/migrate.js";

function withTempMigrations(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void> | void,
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "tyrum-migrations-"));
  return (async () => {
    try {
      for (const [name, contents] of Object.entries(files)) {
        writeFileSync(join(dir, name), contents, "utf-8");
      }
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
}

describe("migration runners", () => {
  it("runs postgres migrations and tracking atomically", async () => {
    await withTempMigrations(
      {
        "001_test.sql": `
          CREATE TABLE test_table (id INT);
        `,
      },
      async (dir) => {
        const calls: Array<{ text: string; params?: unknown[] }> = [];
        const client = {
          query: async (text: string, params?: unknown[]) => {
            const trimmed = text.trim();
            calls.push({ text: trimmed, params });

            if (trimmed.startsWith("SELECT name FROM _migrations")) {
              return { rows: [] };
            }

            if (trimmed.startsWith("INSERT INTO _migrations")) {
              throw new Error("insert failed");
            }

            return { rows: [] };
          },
        };

        await expect(migratePostgres(client as any, dir)).rejects.toThrow("insert failed");

        const beginIndex = calls.findIndex((c) => c.text === "BEGIN");
        const sqlIndex = calls.findIndex((c) => c.text.includes("CREATE TABLE test_table"));
        const insertIndex = calls.findIndex((c) => c.text.startsWith("INSERT INTO _migrations"));
        const rollbackIndex = calls.findIndex((c) => c.text === "ROLLBACK");
        const commitIndex = calls.findIndex((c) => c.text === "COMMIT");

        expect(beginIndex).toBeGreaterThanOrEqual(0);
        expect(sqlIndex).toBeGreaterThanOrEqual(0);
        expect(insertIndex).toBeGreaterThanOrEqual(0);
        expect(rollbackIndex).toBeGreaterThanOrEqual(0);
        expect(commitIndex).toBe(-1);
        expect(beginIndex).toBeLessThan(sqlIndex);
        expect(sqlIndex).toBeLessThan(insertIndex);
        expect(insertIndex).toBeLessThan(rollbackIndex);
      },
    );
  });

  it("commits postgres migration transaction on success", async () => {
    await withTempMigrations(
      {
        "001_test.sql": `
          CREATE TABLE test_table (id INT);
        `,
      },
      async (dir) => {
        const calls: Array<{ text: string; params?: unknown[] }> = [];
        const client = {
          query: async (text: string, params?: unknown[]) => {
            const trimmed = text.trim();
            calls.push({ text: trimmed, params });
            if (trimmed.startsWith("SELECT name FROM _migrations")) {
              return { rows: [] };
            }
            return { rows: [] };
          },
        };

        await expect(migratePostgres(client as any, dir)).resolves.toBeUndefined();

        const beginIndex = calls.findIndex((c) => c.text === "BEGIN");
        const sqlIndex = calls.findIndex((c) => c.text.includes("CREATE TABLE test_table"));
        const insertIndex = calls.findIndex((c) => c.text.startsWith("INSERT INTO _migrations"));
        const commitIndex = calls.findIndex((c) => c.text === "COMMIT");
        const rollbackIndex = calls.findIndex((c) => c.text === "ROLLBACK");

        expect(beginIndex).toBeGreaterThanOrEqual(0);
        expect(sqlIndex).toBeGreaterThanOrEqual(0);
        expect(insertIndex).toBeGreaterThanOrEqual(0);
        expect(commitIndex).toBeGreaterThanOrEqual(0);
        expect(rollbackIndex).toBe(-1);
        expect(beginIndex).toBeLessThan(sqlIndex);
        expect(sqlIndex).toBeLessThan(insertIndex);
        expect(insertIndex).toBeLessThan(commitIndex);
      },
    );
  });

  it("treats renamed postgres migrations as already applied", async () => {
    await withTempMigrations(
      {
        "103_vector_metadata_pk.sql": `
          SELECT * FROM this_should_never_run;
        `,
      },
      async (dir) => {
        const calls: Array<{ text: string; params?: unknown[] }> = [];
        const client = {
          query: async (text: string, params?: unknown[]) => {
            const trimmed = text.trim();
            calls.push({ text: trimmed, params });

            if (trimmed.startsWith("SELECT name FROM _migrations")) {
              return { rows: [{ name: "102_vector_metadata_pk.sql" }] };
            }

            if (trimmed.includes("this_should_never_run")) {
              throw new Error("unexpected migration execution");
            }

            return { rows: [] };
          },
        };

        await expect(migratePostgres(client as any, dir)).resolves.toBeUndefined();

        expect(
          calls.some(
            (c) =>
              c.text.startsWith("INSERT INTO _migrations") &&
              c.params?.[0] === "103_vector_metadata_pk.sql",
          ),
        ).toBe(true);
      },
    );
  });

  it("runs sqlite migrations and tracking atomically", () => {
    return withTempMigrations(
      {
        "001_test.sql": `
          CREATE TABLE test_table (id INTEGER);
          INSERT INTO _migrations (name) VALUES ('001_test.sql');
        `,
      },
      (dir) => {
        const sqlite = createDatabase(":memory:");
        try {
          expect(() => migrate(sqlite, dir)).toThrow();

          const tableRes = sqlite
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
            .all("test_table") as Array<{ name: string }>;
          expect(tableRes).toHaveLength(0);

          const migRes = sqlite
            .prepare("SELECT name FROM _migrations WHERE name = ?")
            .all("001_test.sql") as Array<{ name: string }>;
          expect(migRes).toHaveLength(0);
        } finally {
          sqlite.close();
        }
      },
    );
  });

  it("treats renamed sqlite migrations as already applied", () => {
    return withTempMigrations(
      {
        "103_vector_metadata_pk.sql": `
          CREATE TABLE should_not_run (id INTEGER);
        `,
      },
      (dir) => {
        const sqlite = createDatabase(":memory:");
        try {
          sqlite.exec(`
            CREATE TABLE IF NOT EXISTS _migrations (
              name TEXT PRIMARY KEY,
              applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
          `);
          sqlite
            .prepare("INSERT INTO _migrations (name) VALUES (?)")
            .run("102_vector_metadata_pk.sql");

          migrate(sqlite, dir);

          const tableRes = sqlite
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
            .all("should_not_run") as Array<{ name: string }>;
          expect(tableRes).toHaveLength(0);

          const migRes = sqlite
            .prepare("SELECT name FROM _migrations WHERE name = ?")
            .all("103_vector_metadata_pk.sql") as Array<{ name: string }>;
          expect(migRes).toHaveLength(1);
        } finally {
          sqlite.close();
        }
      },
    );
  });

  it("treats renamed postgres migrations as already applied", async () => {
    await withTempMigrations(
      {
        "103_vector_metadata_pk.sql": `
          CREATE TABLE should_not_run (id INT);
        `,
      },
      async (dir) => {
        const calls: Array<{ text: string; params?: unknown[] }> = [];
        const client = {
          query: async (text: string, params?: unknown[]) => {
            const trimmed = text.trim();
            calls.push({ text: trimmed, params });

            if (trimmed.startsWith("SELECT name FROM _migrations")) {
              return { rows: [{ name: "102_vector_metadata_pk.sql" }] };
            }

            return { rows: [] };
          },
        };

        await expect(migratePostgres(client as any, dir)).resolves.toBeUndefined();

        expect(calls.some((c) => c.text.includes("should_not_run"))).toBe(false);
        expect(calls.some((c) => c.text === "BEGIN")).toBe(false);
        expect(
          calls.some(
            (c) =>
              c.text.startsWith("INSERT INTO _migrations") &&
              Array.isArray(c.params) &&
              c.params[0] === "103_vector_metadata_pk.sql",
          ),
        ).toBe(true);
      },
    );
  });
});
