import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/db.js";
import { createPgMemDb } from "../helpers/pg-mem.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqliteMigrationSql = readFileSync(
  join(__dirname, "../../migrations/sqlite/129_agent_access_defaults_and_identity_cleanup.sql"),
  "utf8",
);
const postgresMigrationSql = readFileSync(
  join(__dirname, "../../migrations/postgres/129_agent_access_defaults_and_identity_cleanup.sql"),
  "utf8",
);

const legacyConfigJson = JSON.stringify({
  tools: {
    allow: [" tool.fs.* ", " read ", "bash", "webfetch", "bash"],
  },
});
const expectedToolConfig = {
  default_mode: "deny",
  allow: ["read", "write", "edit", "apply_patch", "glob", "grep", "bash", "webfetch"],
  deny: [],
};

function createMigrationTablesSqlite(sqlite: ReturnType<typeof createDatabase>): void {
  sqlite.exec(`
    CREATE TABLE agent_configs (config_json TEXT NOT NULL);
    CREATE TABLE agents (
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_key TEXT NOT NULL
    );
    CREATE TABLE agent_identity_revisions (
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      identity_json TEXT NOT NULL
    );
  `);
}

async function createMigrationTablesPostgres(client: {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}): Promise<void> {
  await client.query("CREATE TABLE agent_configs (config_json TEXT NOT NULL)");
  await client.query(
    "CREATE TABLE agents (tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, agent_key TEXT NOT NULL)",
  );
  await client.query(
    "CREATE TABLE agent_identity_revisions (tenant_id TEXT NOT NULL, agent_id TEXT NOT NULL, identity_json TEXT NOT NULL)",
  );
}

describe("agent access defaults migration", () => {
  it("sqlite preserves non-fs tool entries when expanding tool.fs.*", () => {
    const sqlite = createDatabase(":memory:");
    try {
      createMigrationTablesSqlite(sqlite);
      sqlite.prepare("INSERT INTO agent_configs (config_json) VALUES (?)").run(legacyConfigJson);

      sqlite.exec(sqliteMigrationSql);

      const row = sqlite.prepare("SELECT config_json FROM agent_configs").get() as {
        config_json: string;
      };
      expect(JSON.parse(row.config_json)).toEqual({ tools: expectedToolConfig });
    } finally {
      sqlite.close();
    }
  });

  it("postgres preserves non-fs tool entries when expanding tool.fs.*", async () => {
    const mem = createPgMemDb();
    const { Client } = mem.adapters.createPg();
    const pg = new Client();
    await pg.connect();
    try {
      await createMigrationTablesPostgres(pg);
      await pg.query("INSERT INTO agent_configs (config_json) VALUES ($1)", [legacyConfigJson]);

      await pg.query(postgresMigrationSql);

      const result = await pg.query("SELECT config_json FROM agent_configs");
      const row = result.rows[0] as { config_json: string } | undefined;
      expect(row).toBeDefined();
      expect(JSON.parse(row?.config_json ?? "{}")).toEqual({ tools: expectedToolConfig });
    } finally {
      await pg.end();
    }
  });
});
