import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const postgresMigrationSql = readFileSync(
  join(__dirname, "../../migrations/postgres/162_artifact_link_parent_scope_ids.sql"),
  "utf8",
);

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const AGENT_ID = "30000000-0000-4000-8000-000000000002";
const WORKSPACE_ID = "30000000-0000-4000-8000-000000000003";
const ARTIFACT_ID = "30000000-0000-4000-8000-000000000004";
const CREATED_AT = "2026-04-05T00:00:00.000Z";

async function seedArtifact(): Promise<ReturnType<typeof openTestSqliteDb>> {
  const db = openTestSqliteDb();
  await db.run("INSERT INTO tenants (tenant_id, tenant_key) VALUES (?, ?)", [TENANT_ID, "artifact-links"]);
  await db.run("INSERT INTO agents (tenant_id, agent_id, agent_key) VALUES (?, ?, ?)", [
    TENANT_ID,
    AGENT_ID,
    "artifact-links-agent",
  ]);
  await db.run("INSERT INTO workspaces (tenant_id, workspace_id, workspace_key) VALUES (?, ?, ?)", [
    TENANT_ID,
    WORKSPACE_ID,
    "artifact-links-workspace",
  ]);
  await db.run(
    "INSERT INTO agent_workspaces (tenant_id, agent_id, workspace_id) VALUES (?, ?, ?)",
    [TENANT_ID, AGENT_ID, WORKSPACE_ID],
  );
  await db.run(
    `INSERT INTO artifacts (
       tenant_id,
       artifact_id,
       access_id,
       workspace_id,
       agent_id,
       kind,
       uri,
       external_url,
       media_class,
       filename,
       created_at,
       labels_json,
       metadata_json,
       sensitivity
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      TENANT_ID,
      ARTIFACT_ID,
      ARTIFACT_ID,
      WORKSPACE_ID,
      AGENT_ID,
      "log",
      `artifact://${ARTIFACT_ID}`,
      `https://gateway.example.test/a/${ARTIFACT_ID}`,
      "document",
      "artifact.log",
      CREATED_AT,
      "[]",
      "{}",
      "normal",
    ],
  );
  return db;
}

describe("artifact link parent scope ID migrations", () => {
  it("allows the new artifact parent kinds in SQLite", async () => {
    const db = await seedArtifact();

    try {
      for (const [offset, parentKind] of ["turn_item", "workflow_run_step", "dispatch_record"].entries()) {
        await db.run(
          `INSERT INTO artifact_links (
             tenant_id,
             artifact_id,
             parent_kind,
             parent_id,
             created_at
           )
           VALUES (?, ?, ?, ?, ?)`,
          [TENANT_ID, ARTIFACT_ID, parentKind, `parent-${offset + 1}`, CREATED_AT],
        );
      }

      const links = await db.all<{ parent_kind: string }>(
        `SELECT parent_kind
         FROM artifact_links
         WHERE tenant_id = ?
           AND artifact_id = ?
         ORDER BY parent_kind ASC`,
        [TENANT_ID, ARTIFACT_ID],
      );
      expect(links.map((link) => link.parent_kind)).toEqual([
        "dispatch_record",
        "turn_item",
        "workflow_run_step",
      ]);
    } finally {
      await db.close();
    }
  });

  it("updates the Postgres constraint with the new artifact parent kinds", () => {
    expect(postgresMigrationSql).toContain("DROP CONSTRAINT IF EXISTS artifact_links_parent_kind_check");
    expect(postgresMigrationSql).toContain("ADD CONSTRAINT artifact_links_parent_kind_check CHECK");
    expect(postgresMigrationSql).toContain("'turn_item'");
    expect(postgresMigrationSql).toContain("'workflow_run_step'");
    expect(postgresMigrationSql).toContain("'dispatch_record'");
  });
});
