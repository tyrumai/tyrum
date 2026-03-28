import { expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StepExecutor, StepResult } from "../../src/modules/execution/engine.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { action, drain, enqueuePlan, mockCallCount } from "./execution-engine.test-support.js";

async function readOptionalFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export function registerRetrySideEffectTests(fixture: { db: () => SqliteDb }): void {
  it("requires approval to retry a state-changing step without an idempotency_key", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const dir = await mkdtemp(join(tmpdir(), "tyrum-retry-side-effect-"));
    const markerPath = join(dir, "marker.txt");
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      planId: "plan-retry-approval-1",
      requestId: "test-req-1",
      steps: [action("Web", { op: "navigate", url: "https://example.com" })],
    });
    await db.run("UPDATE execution_steps SET max_attempts = 2 WHERE turn_id = ?", [runId]);
    let callCount = 0;
    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        callCount += 1;
        await writeFile(markerPath, `${await readOptionalFile(markerPath)}run\n`, "utf-8");
        if (callCount === 1) return { success: false, error: "transient" };
        return { success: true, result: { ok: true } };
      }),
    };
    try {
      expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(true);
      expect(mockCallCount(mockExecutor)).toBe(1);
      expect(await readOptionalFile(markerPath)).toBe("run\n");
      const approval = await db.get<{ kind: string; resume_token: string | null }>(
        "SELECT kind, resume_token FROM approvals WHERE tenant_id = ? AND turn_id = ? ORDER BY created_at DESC, approval_id DESC LIMIT 1",
        [DEFAULT_TENANT_ID, runId],
      );
      expect(approval?.kind).toBe("retry");
      expect(approval?.resume_token).toBeTruthy();

      expect(await engine.workerTick({ workerId: "w1", executor: mockExecutor })).toBe(false);
      expect(mockCallCount(mockExecutor)).toBe(1);
      expect(await readOptionalFile(markerPath)).toBe("run\n");

      await engine.resumeRun(approval!.resume_token!);
      await drain(engine, "w1", mockExecutor);
      expect(mockCallCount(mockExecutor)).toBe(2);
      expect(await readOptionalFile(markerPath)).toBe("run\nrun\n");
      const run = await db.get<{ status: string }>("SELECT status FROM turns WHERE turn_id = ?", [
        runId,
      ]);
      expect(run?.status).toBe("succeeded");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("short-circuits execution when an idempotency record already succeeded", async () => {
    const db = fixture.db();
    const engine = new ExecutionEngine({ db });
    const dir = await mkdtemp(join(tmpdir(), "tyrum-idempotent-side-effect-"));
    const markerPath = join(dir, "marker.txt");
    await writeFile(markerPath, "seed\n", "utf-8");
    const { runId } = await enqueuePlan(engine, {
      key: "agent:agent-1:telegram-1:group:thread-1",
      planId: "plan-idem-1",
      requestId: "test-req-1",
      steps: [{ ...action("Research"), idempotency_key: "idem-1" }],
    });
    const stepRow = await db.get<{ step_id: string; idempotency_key: string }>(
      "SELECT step_id, idempotency_key FROM execution_steps WHERE turn_id = ?",
      [runId],
    );
    await db.run(
      `INSERT INTO idempotency_records (tenant_id, scope_key, kind, idempotency_key, status, result_json) VALUES (?, ?, 'step', ?, 'succeeded', ?)`,
      [
        DEFAULT_TENANT_ID,
        stepRow!.step_id,
        stepRow!.idempotency_key,
        JSON.stringify({ cached: true }),
      ],
    );
    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        await writeFile(markerPath, `${await readOptionalFile(markerPath)}unexpected\n`, "utf-8");
        return { success: true, result: { shouldNotRun: true } };
      }),
    };
    try {
      await drain(engine, "w1", mockExecutor);
      expect(mockExecutor.execute).not.toHaveBeenCalled();
      expect(await readOptionalFile(markerPath)).toBe("seed\n");
      const attempt = await db.get<{ status: string; result_json: string | null }>(
        "SELECT status, result_json FROM execution_attempts WHERE step_id = ?",
        [stepRow!.step_id],
      );
      expect(attempt!.status).toBe("succeeded");
      expect(JSON.parse(attempt!.result_json ?? "{}")).toEqual({ cached: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
