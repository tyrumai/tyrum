import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createDatabase } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { migratePostgres } from "../../src/migrate-postgres.js";
import { createPgMemDb } from "../helpers/pg-mem.js";
import {
  deleteIds,
  ids,
  legacyIds,
  postgresCases,
  sqliteCases,
} from "./fk-audit-contract.fixtures.js";
import {
  seedPostgresDeleteGuardRows,
  seedSqliteDeleteGuardRows,
} from "./fk-audit-contract.delete-guards.js";
import {
  applyPostgresMigration,
  copyMigrationsBefore,
  postgresMigrationsDir,
  seedPostgresLegacyOrphans,
  seedPostgresScope,
  seedSqliteLegacyOrphans,
  seedSqliteScope,
  sqliteMigrationsDir,
} from "./fk-audit-contract.test-support.js";

describe("FK audit contract", () => {
  it("rejects invalid enforced references in sqlite", () => {
    const sqlite = createDatabase(":memory:");
    migrate(sqlite, sqliteMigrationsDir);

    try {
      seedSqliteScope(sqlite);

      for (const testCase of sqliteCases) {
        expect(() => sqlite.prepare(testCase.sql).run(...testCase.params), testCase.name).toThrow();
      }
    } finally {
      sqlite.close();
    }
  });

  it("rejects invalid enforced references in postgres", async () => {
    const mem = createPgMemDb();
    const { Client } = mem.adapters.createPg();
    const pg = new Client();
    await pg.connect();

    try {
      await migratePostgres(pg, postgresMigrationsDir);
      await seedPostgresScope(pg);

      for (const testCase of postgresCases) {
        await expect(pg.query(testCase.sql, [...testCase.params]), testCase.name).rejects.toThrow();
      }
    } finally {
      await pg.end();
    }
  });

  it("normalizes legacy orphaned refs during sqlite upgrades", () => {
    const sqlite = createDatabase(":memory:");
    const pre111Dir = copyMigrationsBefore(sqliteMigrationsDir, "111_");

    try {
      migrate(sqlite, pre111Dir);
      seedSqliteScope(sqlite);
      seedSqliteLegacyOrphans(sqlite);
      migrate(sqlite, sqliteMigrationsDir);

      const approval = sqlite
        .prepare(
          `SELECT run_id, step_id, attempt_id
           FROM approvals
           WHERE tenant_id = ? AND approval_id = ?`,
        )
        .get(ids.tenantId, legacyIds.approvalId) as
        | { run_id: string | null; step_id: string | null; attempt_id: string | null }
        | undefined;
      expect(approval).toEqual({ run_id: null, step_id: null, attempt_id: null });

      const override = sqlite
        .prepare(
          `SELECT created_from_approval_id
           FROM policy_overrides
           WHERE tenant_id = ? AND policy_override_id = ?`,
        )
        .get(ids.tenantId, legacyIds.policyOverrideId) as
        | { created_from_approval_id: string | null }
        | undefined;
      expect(override).toEqual({ created_from_approval_id: null });

      const outbox = sqlite
        .prepare(
          `SELECT approval_id
           FROM channel_outbox
           WHERE tenant_id = ? AND dedupe_key = ?`,
        )
        .get(ids.tenantId, "fk-audit:legacy-outbox") as { approval_id: string | null } | undefined;
      expect(outbox).toEqual({ approval_id: null });
    } finally {
      rmSync(pre111Dir, { recursive: true, force: true });
      sqlite.close();
    }
  });

  it("normalizes legacy orphaned refs during postgres upgrades", async () => {
    const mem = createPgMemDb();
    const { Client } = mem.adapters.createPg();
    const pg = new Client();
    const pre111Dir = copyMigrationsBefore(postgresMigrationsDir, "111_");
    await pg.connect();

    try {
      await migratePostgres(pg, pre111Dir);
      await seedPostgresScope(pg);
      await seedPostgresLegacyOrphans(pg);

      // pg-mem rejects replaying the CREATE TABLE IF NOT EXISTS _migrations DDL,
      // so apply only the pending upgrade file on the second migration leg.
      await applyPostgresMigration(
        pg,
        postgresMigrationsDir,
        "111_fk_audit_policy_approval_refs.sql",
      );

      const approvalRes = await pg.query(
        `SELECT run_id, step_id, attempt_id
         FROM approvals
         WHERE tenant_id = $1 AND approval_id = $2`,
        [ids.tenantId, legacyIds.approvalId],
      );
      expect(approvalRes.rows[0]).toMatchObject({
        run_id: null,
        step_id: null,
        attempt_id: null,
      });

      const overrideRes = await pg.query(
        `SELECT created_from_approval_id
         FROM policy_overrides
         WHERE tenant_id = $1 AND policy_override_id = $2`,
        [ids.tenantId, legacyIds.policyOverrideId],
      );
      expect(overrideRes.rows[0]).toMatchObject({ created_from_approval_id: null });

      const outboxRes = await pg.query(
        `SELECT approval_id
         FROM channel_outbox
         WHERE tenant_id = $1 AND dedupe_key = $2`,
        [ids.tenantId, "fk-audit:legacy-outbox"],
      );
      expect(outboxRes.rows[0]).toMatchObject({ approval_id: null });
    } finally {
      rmSync(pre111Dir, { recursive: true, force: true });
      await pg.end();
    }
  });

  it("requires explicit child cleanup before deleting audited parents in sqlite", () => {
    const sqlite = createDatabase(":memory:");
    migrate(sqlite, sqliteMigrationsDir);

    try {
      seedSqliteScope(sqlite);
      seedSqliteDeleteGuardRows(sqlite);

      expect(() =>
        sqlite
          .prepare("DELETE FROM execution_runs WHERE tenant_id = ? AND run_id = ?")
          .run(ids.tenantId, deleteIds.runId),
      ).toThrow();
      expect(() =>
        sqlite
          .prepare("DELETE FROM execution_steps WHERE tenant_id = ? AND step_id = ?")
          .run(ids.tenantId, deleteIds.stepId),
      ).toThrow();
      expect(() =>
        sqlite
          .prepare("DELETE FROM execution_attempts WHERE tenant_id = ? AND attempt_id = ?")
          .run(ids.tenantId, deleteIds.attemptId),
      ).toThrow();
      expect(() =>
        sqlite
          .prepare("DELETE FROM approvals WHERE tenant_id = ? AND approval_id = ?")
          .run(ids.tenantId, deleteIds.approvalId),
      ).toThrow();
    } finally {
      sqlite.close();
    }
  });

  it("requires explicit child cleanup before deleting audited parents in postgres", async () => {
    const mem = createPgMemDb();
    const { Client } = mem.adapters.createPg();
    const pg = new Client();
    await pg.connect();

    try {
      await migratePostgres(pg, postgresMigrationsDir);
      await seedPostgresScope(pg);
      await seedPostgresDeleteGuardRows(pg);

      await expect(
        pg.query("DELETE FROM execution_runs WHERE tenant_id = $1 AND run_id = $2", [
          ids.tenantId,
          deleteIds.runId,
        ]),
      ).rejects.toThrow();
      await expect(
        pg.query("DELETE FROM execution_steps WHERE tenant_id = $1 AND step_id = $2", [
          ids.tenantId,
          deleteIds.stepId,
        ]),
      ).rejects.toThrow();
      await expect(
        pg.query("DELETE FROM execution_attempts WHERE tenant_id = $1 AND attempt_id = $2", [
          ids.tenantId,
          deleteIds.attemptId,
        ]),
      ).rejects.toThrow();
      await expect(
        pg.query("DELETE FROM approvals WHERE tenant_id = $1 AND approval_id = $2", [
          ids.tenantId,
          deleteIds.approvalId,
        ]),
      ).rejects.toThrow();
    } finally {
      await pg.end();
    }
  });
});
