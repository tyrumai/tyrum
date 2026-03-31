import { afterEach, describe, expect, it } from "vitest";
import type { RunnableTurnRow } from "../../src/modules/execution/engine/shared.js";
import { finalizeRunWithoutQueuedStepTx } from "../../src/modules/execution/engine/step-execution-state.js";
import type { StepExecutionClaimDeps } from "../../src/modules/execution/engine/step-execution.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { enqueuePlan, action } from "./execution-engine.test-support.js";

describe("step-execution-state", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("preserves cancelled turn progress when finalization loses the status update race", async () => {
    db = openTestSqliteDb();
    const engine = new ExecutionEngine({ db });
    const { turnId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      planId: "plan-finalize-cancel-race-1",
      requestId: "test-req-finalize-cancel-race-1",
      steps: [action("Research")],
    });

    const staleRun = await db.get<RunnableTurnRow>(
      `SELECT
         r.tenant_id,
         r.turn_id AS turn_id,
         r.job_id,
         j.agent_id,
         r.conversation_key AS key,
         r.status,
         j.trigger_json,
         j.workspace_id,
         r.policy_snapshot_id,
         r.lease_owner,
         r.lease_expires_at_ms,
         r.checkpoint_json,
         r.last_progress_at,
         r.last_progress_json
       FROM turns r
       JOIN turn_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
       WHERE r.turn_id = ?`,
      [turnId],
    );
    expect(staleRun).toBeTruthy();

    await expect(engine.cancelTurn(turnId, "operator cancelled")).resolves.toBe("cancelled");

    const deps: StepExecutionClaimDeps = {
      db,
      approvalManager: {
        maybeRetryOrFailStep: async () => false,
        pauseRunForApproval: async () => {
          throw new Error("not expected in finalizeRunWithoutQueuedStepTx test");
        },
      },
      redactText: (text) => text,
      redactUnknown: <T>(value: T): T => value,
      emitTurnUpdatedTx: async () => {},
      emitStepUpdatedTx: async () => {},
      emitAttemptUpdatedTx: async () => {},
      emitTurnStartedTx: async () => {},
      emitTurnCompletedTx: async () => {},
      emitTurnFailedTx: async () => {},
      isApprovedPolicyGateTx: async () => false,
      resolveSecretScopesFromArgs: async () => [],
      maybePauseForToolIntentGuardrailTx: async () => undefined,
    };

    await db.transaction(async (tx) => {
      await finalizeRunWithoutQueuedStepTx({
        deps,
        tx,
        run: staleRun!,
        workerId: "worker-1",
        clock: {
          nowMs: Date.now(),
          nowIso: new Date().toISOString(),
        },
      });
    });

    const turn = await db.get<{ status: string; last_progress_json: string | null }>(
      "SELECT status, last_progress_json FROM turns WHERE turn_id = ?",
      [turnId],
    );
    expect(turn?.status).toBe("cancelled");
    expect(JSON.parse(turn?.last_progress_json ?? "{}")).toMatchObject({
      kind: "turn.cancelled",
      reason: "operator cancelled",
    });
  });
});
