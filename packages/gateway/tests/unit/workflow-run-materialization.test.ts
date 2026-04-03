import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowRunMaterializer } from "../../src/modules/execution/engine/workflow-run-materialization.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { WorkflowRunDal } from "../../src/modules/workflow-run/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

function createCancelRaceProxy(input: {
  primary: SqlDb;
  beforeCancelUpdate: () => Promise<void>;
}): SqlDb {
  const shouldInjectBeforeCancel = (sql: string): boolean =>
    sql.includes("UPDATE workflow_runs") && sql.includes("status = 'cancelled'");

  return {
    kind: input.primary.kind,
    get: async (sql, params) => await input.primary.get(sql, params),
    all: async (sql, params) => await input.primary.all(sql, params),
    run: async (sql, params) => await input.primary.run(sql, params),
    exec: async (sql) => await input.primary.exec(sql),
    close: async () => await input.primary.close(),
    transaction: async (fn) =>
      await input.primary.transaction(async (tx) => {
        let injected = false;
        const maybeInject = async (sql: string): Promise<void> => {
          if (injected || !shouldInjectBeforeCancel(sql)) {
            return;
          }
          injected = true;
          await input.beforeCancelUpdate();
        };

        const txProxy: SqlDb = {
          kind: tx.kind,
          get: async (sql, params) => {
            await maybeInject(sql);
            return await tx.get(sql, params);
          },
          all: async (sql, params) => await tx.all(sql, params),
          run: async (sql, params) => {
            await maybeInject(sql);
            return await tx.run(sql, params);
          },
          exec: async (sql) => await tx.exec(sql),
          close: async () => await tx.close(),
          transaction: async (nested) => await tx.transaction(nested),
        };

        return await fn(txProxy);
      }),
  };
}

describe("WorkflowRunMaterializer", () => {
  let tempDir: string;
  let primaryDb: SqliteDb;
  let secondaryDb: SqliteDb;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-workflow-run-materialization-"));
    const dbPath = join(tempDir, "gateway.db");
    primaryDb = openTestSqliteDb(dbPath);
    secondaryDb = openTestSqliteDb(dbPath);
  });

  afterEach(async () => {
    await Promise.allSettled([primaryDb?.close(), secondaryDb?.close()]);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("does not overwrite a terminal workflow run when cancellation loses the status race", async () => {
    const workflowRunId = "11111111-1111-4111-8111-111111111111";
    await new WorkflowRunDal(primaryDb).createRunWithSteps({
      run: {
        workflowRunId,
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        runKey: "agent:default:main",
        conversationKey: "agent:default:main",
        trigger: {
          kind: "api",
          metadata: { conversation_key: "agent:default:main" },
        },
        planId: "plan-cancel-race-1",
        requestId: "req-cancel-race-1",
      },
      steps: [{ action: { type: "CLI" } }],
    });

    const succeededAt = "2026-04-03T09:00:00.000Z";
    const materializer = new WorkflowRunMaterializer({
      db: createCancelRaceProxy({
        primary: primaryDb,
        beforeCancelUpdate: async () => {
          await secondaryDb.run(
            `UPDATE workflow_runs
             SET status = 'succeeded',
                 updated_at = ?,
                 finished_at = ?
             WHERE tenant_id = ? AND workflow_run_id = ?`,
            [succeededAt, succeededAt, DEFAULT_TENANT_ID, workflowRunId],
          );
        },
      }),
      materializeExecutionStateInTx: async () => {
        throw new Error("not expected");
      },
    });

    await expect(materializer.cancelIfPresent(workflowRunId)).resolves.toBe("already_terminal");

    const run = await primaryDb.get<{ status: string; finished_at: string | null }>(
      `SELECT status, finished_at
       FROM workflow_runs
       WHERE tenant_id = ? AND workflow_run_id = ?`,
      [DEFAULT_TENANT_ID, workflowRunId],
    );
    expect(run).toEqual({
      status: "succeeded",
      finished_at: succeededAt,
    });

    const steps = await primaryDb.all<{ status: string }>(
      `SELECT status
       FROM workflow_run_steps
       WHERE tenant_id = ? AND workflow_run_id = ?
       ORDER BY step_index ASC`,
      [DEFAULT_TENANT_ID, workflowRunId],
    );
    expect(steps.map((step) => step.status)).toEqual(["queued"]);
  });
});
