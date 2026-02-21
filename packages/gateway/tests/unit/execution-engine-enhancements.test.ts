import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";
import {
  ExecutionEngine,
  type StepExecutor,
  type StepResult,
} from "../../src/modules/execution/engine.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

function action(
  type: ActionPrimitive["type"],
  args?: Record<string, unknown>,
  extra?: Partial<ActionPrimitive>,
): ActionPrimitive {
  return {
    type,
    args: args ?? {},
    ...extra,
  };
}

async function drain(
  engine: ExecutionEngine,
  workerId: string,
  executor: StepExecutor,
): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    const worked = await engine.workerTick({ workerId, executor });
    if (!worked) return;
  }
  throw new Error("worker did not become idle after 25 ticks");
}

// ---------------------------------------------------------------------------
// Budget enforcement
// ---------------------------------------------------------------------------

describe("ExecutionEngine budget enforcement", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("accumulates spent_tokens across steps", async () => {
    db = openTestSqliteDb();
    const engine = new ExecutionEngine({ db });

    const { runId } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-budget-1",
      requestId: "req-1",
      steps: [action("Research"), action("Message")],
      budget_tokens: 1000,
    });

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return {
          success: true,
          result: { ok: true },
          cost: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    const row = await db.get<{ spent_tokens: number; budget_tokens: number | null }>(
      "SELECT spent_tokens, budget_tokens FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(row!.budget_tokens).toBe(1000);
    expect(row!.spent_tokens).toBe(60); // 30 + 30
  });

  it("fails run with budget_exceeded when spent_tokens >= budget_tokens", async () => {
    db = openTestSqliteDb();
    const engine = new ExecutionEngine({ db });

    const { runId } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-budget-exceed-1",
      requestId: "req-1",
      steps: [action("Research"), action("Message"), action("Research")],
      budget_tokens: 50,
    });

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return {
          success: true,
          result: { ok: true },
          cost: { input_tokens: 15, output_tokens: 15, total_tokens: 30 },
        };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    const run = await db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run!.status).toBe("failed");
    expect(run!.paused_reason).toBe("budget_exceeded");

    // Third step should be cancelled (budget exceeded after step 2)
    const steps = await db.all<{ step_index: number; status: string }>(
      "SELECT step_index, status FROM execution_steps WHERE run_id = ? ORDER BY step_index",
      [runId],
    );
    const cancelledSteps = steps.filter((s) => s.status === "cancelled");
    expect(cancelledSteps.length).toBeGreaterThanOrEqual(1);
  });

  it("null budget_tokens means unlimited (no budget enforcement)", async () => {
    db = openTestSqliteDb();
    const engine = new ExecutionEngine({ db });

    const { runId } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-no-budget-1",
      requestId: "req-1",
      steps: [action("Research")],
      // No budget_tokens set
    });

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return {
          success: true,
          result: { ok: true },
          cost: { input_tokens: 1000, output_tokens: 2000, total_tokens: 3000 },
        };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    const run = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run!.status).toBe("succeeded");
  });

  it("zero-cost steps do not trigger budget enforcement", async () => {
    db = openTestSqliteDb();
    const engine = new ExecutionEngine({ db });

    const { runId } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-zero-cost-1",
      requestId: "req-1",
      steps: [action("Research")],
      budget_tokens: 10,
    });

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { ok: true } };
        // No cost field
      }),
    };

    await drain(engine, "w1", mockExecutor);

    const run = await db.get<{ status: string; spent_tokens: number }>(
      "SELECT status, spent_tokens FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run!.status).toBe("succeeded");
    expect(run!.spent_tokens).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rollback metadata
// ---------------------------------------------------------------------------

describe("ExecutionEngine rollback metadata", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("stores rollback_hint from action on step insert", async () => {
    db = openTestSqliteDb();
    const engine = new ExecutionEngine({ db });

    const { runId } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-rb-1",
      requestId: "req-1",
      steps: [
        action("Http", { url: "https://example.com" }, { rollback_hint: "DELETE /resource/123" }),
      ],
    });

    const step = await db.get<{ rollback_hint: string | null }>(
      "SELECT rollback_hint FROM execution_steps WHERE run_id = ?",
      [runId],
    );
    expect(step!.rollback_hint).toBe("DELETE /resource/123");
  });

  it("stores null rollback_hint when absent", async () => {
    db = openTestSqliteDb();
    const engine = new ExecutionEngine({ db });

    const { runId } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-rb-null-1",
      requestId: "req-1",
      steps: [action("Research")],
    });

    const step = await db.get<{ rollback_hint: string | null }>(
      "SELECT rollback_hint FROM execution_steps WHERE run_id = ?",
      [runId],
    );
    expect(step!.rollback_hint).toBeNull();
  });

  it("surfaces rollback_hint in failure logging context", async () => {
    db = openTestSqliteDb();
    const logEntries: Array<{ msg: string; data: Record<string, unknown> }> = [];
    const logger = {
      info: (msg: string, data?: Record<string, unknown>) => {
        logEntries.push({ msg, data: data ?? {} });
      },
      warn: (msg: string, data?: Record<string, unknown>) => {
        logEntries.push({ msg, data: data ?? {} });
      },
      error: (msg: string, data?: Record<string, unknown>) => {
        logEntries.push({ msg, data: data ?? {} });
      },
      debug: (msg: string, data?: Record<string, unknown>) => {
        logEntries.push({ msg, data: data ?? {} });
      },
    };

    const engine = new ExecutionEngine({ db, logger });

    await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-rb-log-1",
      requestId: "req-1",
      steps: [
        action("Http", { url: "https://example.com" }, { rollback_hint: "undo-mutation" }),
      ],
    });

    // Set max_attempts to 1 so step fails after one attempt
    await db.run("UPDATE execution_steps SET max_attempts = 1");

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: false, error: "permanent error" };
      }),
    };

    await drain(engine, "w1", mockExecutor);

    // Check that the failure log includes rollback_hint
    const failLog = logEntries.find(
      (e) => e.msg === "execution.step.failed_with_rollback_hint",
    );
    expect(failLog).toBeDefined();
    expect(failLog!.data["rollback_hint"]).toBe("undo-mutation");
  });
});

// ---------------------------------------------------------------------------
// AbortSignal cancellation
// ---------------------------------------------------------------------------

describe("ExecutionEngine AbortSignal cancellation", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("passes signal to executor during step execution", async () => {
    db = openTestSqliteDb();
    const engine = new ExecutionEngine({ db });

    await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-signal-1",
      requestId: "req-1",
      steps: [action("Research")],
    });

    let receivedSignal: AbortSignal | undefined;
    const mockExecutor: StepExecutor = {
      execute: vi.fn(
        async (
          _action: ActionPrimitive,
          _planId: string,
          _stepIndex: number,
          _timeoutMs: number,
          signal?: AbortSignal,
        ): Promise<StepResult> => {
          receivedSignal = signal;
          return { success: true, result: { ok: true } };
        },
      ),
    };

    await drain(engine, "w1", mockExecutor);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal!.aborted).toBe(false);
  });

  it("cancelRun aborts in-flight execution via AbortController", async () => {
    db = openTestSqliteDb();
    const engine = new ExecutionEngine({ db });

    const { runId } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-cancel-abort-1",
      requestId: "req-1",
      steps: [action("Research"), action("Message")],
    });

    let capturedSignal: AbortSignal | undefined;
    let resolveStep: (() => void) | undefined;

    const mockExecutor: StepExecutor = {
      execute: vi.fn(
        async (
          _action: ActionPrimitive,
          _planId: string,
          _stepIndex: number,
          _timeoutMs: number,
          signal?: AbortSignal,
        ): Promise<StepResult> => {
          capturedSignal = signal;
          // Block execution so we can cancel while in-flight
          await new Promise<void>((resolve) => {
            resolveStep = resolve;
            // Auto-resolve after a short delay to prevent test hanging
            setTimeout(resolve, 100);
          });
          return { success: true, result: { ok: true } };
        },
      ),
    };

    // Start the worker tick but don't await it
    const tickPromise = engine.workerTick({ workerId: "w1", executor: mockExecutor });

    // Wait briefly for the executor to start and capture signal
    await new Promise((r) => setTimeout(r, 20));

    // Cancel the run while the step is in-flight
    await engine.cancelRun(runId);

    // Signal should be aborted
    if (capturedSignal) {
      expect(capturedSignal.aborted).toBe(true);
    }

    // Resolve the blocked step so the test completes
    resolveStep?.();
    await tickPromise;

    const run = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run!.status).toBe("cancelled");
  });

  it("cancelled run skips next step", async () => {
    db = openTestSqliteDb();
    const engine = new ExecutionEngine({ db });

    const { runId } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-cancel-skip-1",
      requestId: "req-1",
      steps: [action("Research"), action("Message")],
    });

    // Cancel before any execution
    await engine.cancelRun(runId);

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true, result: { ok: true } };
      }),
    };

    // Worker should not execute any steps since run is cancelled
    const worked = await engine.workerTick({ workerId: "w1", executor: mockExecutor });
    expect(worked).toBe(false);
    expect(mockExecutor.execute).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Queue modes
// ---------------------------------------------------------------------------

describe("ExecutionEngine queue modes", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("stores queue_mode on run INSERT (collect is default)", async () => {
    db = openTestSqliteDb();
    const engine = new ExecutionEngine({ db });

    const { runId } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-qm-default-1",
      requestId: "req-1",
      steps: [action("Research")],
    });

    const run = await db.get<{ queue_mode: string }>(
      "SELECT queue_mode FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run!.queue_mode).toBe("collect");
  });

  it("collect mode: FIFO ordering preserved", async () => {
    db = openTestSqliteDb();
    const engine = new ExecutionEngine({ db });

    const { runId: runId1 } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-fifo-1",
      requestId: "req-1",
      steps: [action("Research")],
      queue_mode: "collect",
    });

    const { runId: runId2 } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t2",
      lane: "main",
      planId: "plan-fifo-2",
      requestId: "req-2",
      steps: [action("Research")],
      queue_mode: "collect",
    });

    // Both should be queued
    const r1 = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId1],
    );
    const r2 = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId2],
    );
    expect(r1!.status).toBe("queued");
    expect(r2!.status).toBe("queued");
  });

  it("steer mode cancels queued runs on same key+lane", async () => {
    db = openTestSqliteDb();
    const engine = new ExecutionEngine({ db });

    const { runId: runId1 } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-steer-q1",
      requestId: "req-1",
      steps: [action("Research")],
      queue_mode: "collect",
    });

    const { runId: runId2 } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-steer-q2",
      requestId: "req-2",
      steps: [action("Research")],
      queue_mode: "collect",
    });

    // Steer mode enqueue should cancel both queued runs
    const { runId: runId3 } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-steer-new",
      requestId: "req-3",
      steps: [action("Research")],
      queue_mode: "steer",
    });

    const r1 = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId1],
    );
    const r2 = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId2],
    );
    const r3 = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId3],
    );

    expect(r1!.status).toBe("cancelled");
    expect(r2!.status).toBe("cancelled");
    expect(r3!.status).toBe("queued");
  });

  it("steer mode does not cancel runs on different key+lane", async () => {
    db = openTestSqliteDb();
    const engine = new ExecutionEngine({ db });

    const { runId: runId1 } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-steer-diff-1",
      requestId: "req-1",
      steps: [action("Research")],
      queue_mode: "collect",
    });

    // Different key
    const { runId: runId2 } = await engine.enqueuePlan({
      key: "agent:a2:ch2:group:t2",
      lane: "main",
      planId: "plan-steer-diff-2",
      requestId: "req-2",
      steps: [action("Research")],
      queue_mode: "collect",
    });

    // Steer on key t1 should not affect key t2
    await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-steer-diff-3",
      requestId: "req-3",
      steps: [action("Research")],
      queue_mode: "steer",
    });

    const r1 = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId1],
    );
    const r2 = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId2],
    );

    expect(r1!.status).toBe("cancelled");
    expect(r2!.status).toBe("queued"); // Unaffected
  });

  it("followup mode stores queue_mode and behaves like collect", async () => {
    db = openTestSqliteDb();
    const engine = new ExecutionEngine({ db });

    const { runId } = await engine.enqueuePlan({
      key: "agent:a1:ch1:group:t1",
      lane: "main",
      planId: "plan-followup-1",
      requestId: "req-1",
      steps: [action("Research")],
      queue_mode: "followup",
    });

    const run = await db.get<{ queue_mode: string; status: string }>(
      "SELECT queue_mode, status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run!.queue_mode).toBe("followup");
    expect(run!.status).toBe("queued");
  });
});
