import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/db.js";
import { createPgMemDb } from "../helpers/pg-mem.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqliteMigrationSql = readFileSync(
  join(__dirname, "../../migrations/sqlite/164_canonical_public_memory_tool_ids.sql"),
  "utf8",
);
const postgresMigrationSql = readFileSync(
  join(__dirname, "../../migrations/postgres/164_canonical_public_memory_tool_ids.sql"),
  "utf8",
);

const legacyAgentConfigJson = JSON.stringify({
  mcp: {
    pre_turn_tools: ["mcp.memory.seed", "mcp.memory.search"],
  },
  tools: {
    allow: ["mcp.memory.write"],
    deny: ["mcp.memory.search"],
  },
});
const legacyApprovalContextJson = JSON.stringify({
  tool_id: "mcp.memory.write",
  tool_ids: ["mcp.memory.seed", "mcp.memory.search"],
});
const legacyPolicyBundleJson = JSON.stringify({
  v: 1,
  tools: {
    allow: ["mcp.memory.search"],
    require_approval: ["mcp.memory.write"],
    deny: ["mcp.memory.seed"],
  },
});
const expectedAgentConfig = {
  mcp: {
    pre_turn_tools: ["memory.seed", "memory.search"],
  },
  tools: {
    allow: ["memory.write"],
    deny: ["memory.search"],
  },
};
const expectedApprovalContext = {
  tool_id: "memory.write",
  tool_ids: ["memory.seed", "memory.search"],
};
const expectedPolicyBundle = {
  v: 1,
  tools: {
    allow: ["memory.search"],
    require_approval: ["memory.write"],
    deny: ["memory.seed"],
  },
};

function createMigrationTablesSqlite(sqlite: ReturnType<typeof createDatabase>): void {
  sqlite.exec(`
    CREATE TABLE agent_configs (config_json TEXT NOT NULL);
    CREATE TABLE policy_bundle_config_revisions (bundle_json TEXT NOT NULL);
    CREATE TABLE policy_snapshots (sha256 TEXT NOT NULL, bundle_json TEXT NOT NULL);
    CREATE TABLE policy_overrides (tool_id TEXT NOT NULL);
    CREATE TABLE approvals (context_json TEXT NOT NULL);
  `);
}

async function createMigrationTablesPostgres(client: {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}): Promise<void> {
  await client.query("CREATE TABLE agent_configs (config_json TEXT NOT NULL)");
  await client.query("CREATE TABLE policy_bundle_config_revisions (bundle_json TEXT NOT NULL)");
  await client.query(
    "CREATE TABLE policy_snapshots (sha256 TEXT NOT NULL, bundle_json TEXT NOT NULL)",
  );
  await client.query("CREATE TABLE policy_overrides (tool_id TEXT NOT NULL)");
  await client.query("CREATE TABLE approvals (context_json TEXT NOT NULL)");
}

function seedSqlite(sqlite: ReturnType<typeof createDatabase>): void {
  sqlite.prepare("INSERT INTO agent_configs (config_json) VALUES (?)").run(legacyAgentConfigJson);
  sqlite
    .prepare("INSERT INTO policy_bundle_config_revisions (bundle_json) VALUES (?)")
    .run(legacyPolicyBundleJson);
  sqlite
    .prepare("INSERT INTO policy_snapshots (sha256, bundle_json) VALUES (?, ?)")
    .run("legacy-sha", legacyPolicyBundleJson);
  sqlite.prepare("INSERT INTO policy_overrides (tool_id) VALUES (?)").run("mcp.memory.write");
  sqlite.prepare("INSERT INTO approvals (context_json) VALUES (?)").run(legacyApprovalContextJson);
}

async function seedPostgres(client: {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}): Promise<void> {
  await client.query("INSERT INTO agent_configs (config_json) VALUES ($1)", [
    legacyAgentConfigJson,
  ]);
  await client.query("INSERT INTO policy_bundle_config_revisions (bundle_json) VALUES ($1)", [
    legacyPolicyBundleJson,
  ]);
  await client.query("INSERT INTO policy_snapshots (sha256, bundle_json) VALUES ($1, $2)", [
    "legacy-sha",
    legacyPolicyBundleJson,
  ]);
  await client.query("INSERT INTO policy_overrides (tool_id) VALUES ($1)", ["mcp.memory.write"]);
  await client.query("INSERT INTO approvals (context_json) VALUES ($1)", [
    legacyApprovalContextJson,
  ]);
}

describe("canonical public memory tool IDs migration", () => {
  it("sqlite rewrites durable legacy memory IDs and stays idempotent", () => {
    const sqlite = createDatabase(":memory:");
    try {
      createMigrationTablesSqlite(sqlite);
      seedSqlite(sqlite);

      sqlite.exec(sqliteMigrationSql);
      sqlite.exec(sqliteMigrationSql);

      const agentConfigRow = sqlite.prepare("SELECT config_json FROM agent_configs").get() as {
        config_json: string;
      };
      const policyBundleRow = sqlite
        .prepare("SELECT bundle_json FROM policy_bundle_config_revisions")
        .get() as { bundle_json: string };
      const policySnapshotRow = sqlite
        .prepare("SELECT bundle_json FROM policy_snapshots")
        .get() as {
        bundle_json: string;
      };
      const policyOverrideRow = sqlite.prepare("SELECT tool_id FROM policy_overrides").get() as {
        tool_id: string;
      };
      const approvalRow = sqlite.prepare("SELECT context_json FROM approvals").get() as {
        context_json: string;
      };

      expect(JSON.parse(agentConfigRow.config_json)).toEqual(expectedAgentConfig);
      expect(JSON.parse(policyBundleRow.bundle_json)).toEqual(expectedPolicyBundle);
      expect(JSON.parse(policySnapshotRow.bundle_json)).toEqual(expectedPolicyBundle);
      expect(policyOverrideRow.tool_id).toBe("memory.write");
      expect(JSON.parse(approvalRow.context_json)).toEqual(expectedApprovalContext);
    } finally {
      sqlite.close();
    }
  });

  it("postgres rewrites durable legacy memory IDs and stays idempotent", async () => {
    const mem = createPgMemDb();
    const { Client } = mem.adapters.createPg();
    const pg = new Client();
    await pg.connect();
    try {
      await createMigrationTablesPostgres(pg);
      await seedPostgres(pg);

      await pg.query(postgresMigrationSql);
      await pg.query(postgresMigrationSql);

      const agentConfigResult = await pg.query("SELECT config_json FROM agent_configs");
      const policyBundleResult = await pg.query(
        "SELECT bundle_json FROM policy_bundle_config_revisions",
      );
      const policySnapshotResult = await pg.query("SELECT bundle_json FROM policy_snapshots");
      const policyOverrideResult = await pg.query("SELECT tool_id FROM policy_overrides");
      const approvalResult = await pg.query("SELECT context_json FROM approvals");

      const agentConfigRow = agentConfigResult.rows[0] as { config_json: string } | undefined;
      const policyBundleRow = policyBundleResult.rows[0] as { bundle_json: string } | undefined;
      const policySnapshotRow = policySnapshotResult.rows[0] as { bundle_json: string } | undefined;
      const policyOverrideRow = policyOverrideResult.rows[0] as { tool_id: string } | undefined;
      const approvalRow = approvalResult.rows[0] as { context_json: string } | undefined;

      expect(agentConfigRow).toBeDefined();
      expect(policyBundleRow).toBeDefined();
      expect(policySnapshotRow).toBeDefined();
      expect(policyOverrideRow).toBeDefined();
      expect(approvalRow).toBeDefined();
      expect(JSON.parse(agentConfigRow?.config_json ?? "{}")).toEqual(expectedAgentConfig);
      expect(JSON.parse(policyBundleRow?.bundle_json ?? "{}")).toEqual(expectedPolicyBundle);
      expect(JSON.parse(policySnapshotRow?.bundle_json ?? "{}")).toEqual(expectedPolicyBundle);
      expect(policyOverrideRow?.tool_id).toBe("memory.write");
      expect(JSON.parse(approvalRow?.context_json ?? "{}")).toEqual(expectedApprovalContext);
    } finally {
      await pg.end();
    }
  });
});
