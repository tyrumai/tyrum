import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import type { StepExecutor } from "../../src/modules/execution/engine.js";

describe("HA failure matrix (gateway primitives)", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("recovers from a crashed worker by taking over an expired attempt lease", async () => {
    db = openTestSqliteDb();

    let nowMs = Date.parse("2026-02-21T00:00:00Z");
    const clock = () => ({
      nowMs,
      nowIso: new Date(nowMs).toISOString(),
    });

    const engine = new ExecutionEngine({ db, clock });

    const { jobId, runId } = await engine.enqueuePlan({
      key: "agent:agent-1:telegram:default:group:thread-1",
      lane: "main",
      planId: "plan-ha-1",
      requestId: "req-ha-1",
      steps: [{ type: "Research", args: { note: "hello" } }],
    });

    const step = await db.get<{ step_id: string }>(
      "SELECT step_id FROM execution_steps WHERE run_id = ? AND step_index = 0",
      [runId],
    );
    expect(step?.step_id).toBeTruthy();

    // Simulate a prior worker that crashed mid-step: step marked running with an expired attempt lease.
    await db.run(
      `UPDATE execution_steps SET status = 'running' WHERE step_id = ?`,
      [step!.step_id],
    );
    await db.run(
      `INSERT INTO execution_attempts (
         attempt_id,
         step_id,
         attempt,
         status,
         started_at,
         artifacts_json,
         lease_owner,
         lease_expires_at_ms
       ) VALUES (?, ?, 1, 'running', ?, '[]', ?, ?)`,
      [
        "attempt-crashed-1",
        step!.step_id,
        new Date(nowMs).toISOString(),
        "worker-a",
        nowMs - 1,
      ],
    );

    let executorCalls = 0;
    const executor: StepExecutor = {
      execute: async () => {
        executorCalls += 1;
        return { success: true, result: { ok: true } };
      },
    };

    // First tick performs recovery only (no executor call yet).
    const didRecover = await engine.workerTick({ workerId: "worker-b", executor });
    expect(didRecover).toBe(true);
    expect(executorCalls).toBe(0);

    const recoveredStep = await db.get<{ status: string }>(
      "SELECT status FROM execution_steps WHERE step_id = ?",
      [step!.step_id],
    );
    expect(recoveredStep?.status).toBe("queued");

    // Second tick claims and executes the re-queued step.
    const didExecute = await engine.workerTick({ workerId: "worker-b", executor });
    expect(didExecute).toBe(true);
    expect(executorCalls).toBe(1);

    // Third tick finalizes the run/job after the last step completes.
    const didFinalize = await engine.workerTick({ workerId: "worker-b", executor });
    expect(didFinalize).toBe(true);
    expect(executorCalls).toBe(1);

    const run = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("succeeded");

    const job = await db.get<{ status: string }>(
      "SELECT status FROM execution_jobs WHERE job_id = ?",
      [jobId],
    );
    expect(job?.status).toBe("completed");

    const attempts = await db.all<{ status: string; error: string | null }>(
      "SELECT status, error FROM execution_attempts WHERE step_id = ? ORDER BY attempt ASC",
      [step!.step_id],
    );
    expect(attempts.map((a) => a.status)).toEqual(["cancelled", "succeeded"]);
    expect(attempts[0]!.error).toContain("lease expired");
  });
});
