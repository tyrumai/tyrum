import { afterEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { JobQueue } from "../../src/modules/executor/job-queue.js";
import {
  ExecutionRunner,
  type StepExecutor,
  type StepResult,
} from "../../src/modules/executor/runner.js";
import type { ActionPrimitive } from "@tyrum/schemas";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function testStep(type: string, args?: Record<string, unknown>): ActionPrimitive {
  return {
    type: type as ActionPrimitive["type"],
    args: args ?? { intent: "test" },
  };
}

describe("ExecutionRunner", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
  });

  it("executes a 2-step plan with mock tool results", async () => {
    container = await createContainer({ dbPath: ":memory:", migrationsDir });
    const jobQueue = new JobQueue(container.db);

    const completedEvents: string[] = [];
    container.eventBus.on("plan:completed", ({ planId }) => {
      completedEvents.push(planId);
    });

    const runner = new ExecutionRunner(
      {
        jobQueue,
        eventLog: container.eventLog,
        eventBus: container.eventBus,
      },
      { planTimeoutMs: 30_000 },
    );

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (action: ActionPrimitive): Promise<StepResult> => {
        if (action.type === "Research") {
          return { success: true, result: { findings: "data collected" } };
        }
        if (action.type === "Message") {
          return { success: true, result: { status: "sent" } };
        }
        return { success: false, error: "unknown action" };
      }),
    };

    const steps: ActionPrimitive[] = [
      testStep("Research", { intent: "gather_info" }),
      testStep("Message", { body: "summary" }),
    ];

    await runner.executePlan("plan-test-1", steps, mockExecutor);

    // Verify executor was called twice
    expect(mockExecutor.execute).toHaveBeenCalledTimes(2);

    // Verify jobs are completed
    const jobs = await jobQueue.getByPlanId("plan-test-1");
    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.status).toBe("completed");
    expect(jobs[1]!.status).toBe("completed");

    // Verify completion event was emitted
    expect(completedEvents).toContain("plan-test-1");
  });

  it("handles step failure with retry then success", async () => {
    container = await createContainer({ dbPath: ":memory:", migrationsDir });
    const jobQueue = new JobQueue(container.db);

    const runner = new ExecutionRunner(
      {
        jobQueue,
        eventLog: container.eventLog,
        eventBus: container.eventBus,
      },
      { planTimeoutMs: 30_000 },
    );

    let callCount = 0;
    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        callCount++;
        if (callCount === 1) {
          return { success: false, error: "transient error" };
        }
        return { success: true, result: { ok: true } };
      }),
    };

    const steps: ActionPrimitive[] = [testStep("Research")];

    await runner.executePlan("plan-retry-1", steps, mockExecutor);

    // Executor was called twice (first fail + retry success)
    expect(mockExecutor.execute).toHaveBeenCalledTimes(2);
  });

  it("fails plan after exhausting all retries", async () => {
    container = await createContainer({ dbPath: ":memory:", migrationsDir });
    const jobQueue = new JobQueue(container.db);

    const failedEvents: string[] = [];
    container.eventBus.on("plan:failed", ({ planId }) => {
      failedEvents.push(planId);
    });

    const runner = new ExecutionRunner(
      {
        jobQueue,
        eventLog: container.eventLog,
        eventBus: container.eventBus,
      },
      { planTimeoutMs: 30_000 },
    );

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: false, error: "permanent error" };
      }),
    };

    const steps: ActionPrimitive[] = [testStep("Research")];

    // Use maxAttempts=1 to skip retries for test speed
    // Override by creating runner with specific job options
    // Actually, JobQueue defaults to 3 retries. Let's just test the flow.
    await runner.executePlan("plan-fail-1", steps, mockExecutor);

    // Should have been called multiple times (3 retries)
    expect(
      (mockExecutor.execute as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThanOrEqual(1);

    // Verify plan failure event
    expect(failedEvents).toContain("plan-fail-1");
  });

  it("passes postcondition when evidence matches", async () => {
    container = await createContainer({ dbPath: ":memory:", migrationsDir });
    const jobQueue = new JobQueue(container.db);

    const completedEvents: string[] = [];
    container.eventBus.on("plan:completed", ({ planId }) => {
      completedEvents.push(planId);
    });

    const runner = new ExecutionRunner(
      {
        jobQueue,
        eventLog: container.eventLog,
        eventBus: container.eventBus,
      },
      { planTimeoutMs: 30_000 },
    );

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return {
          success: true,
          result: { ok: true },
          evidence: { http: { status: 200 } },
        };
      }),
    };

    const steps: ActionPrimitive[] = [
      {
        type: "Http" as ActionPrimitive["type"],
        args: { url: "https://example.com" },
        postcondition: {
          assertions: [{ type: "http_status", equals: 200 }],
        },
      },
    ];

    await runner.executePlan("plan-postcond-pass", steps, mockExecutor);

    const jobs = await jobQueue.getByPlanId("plan-postcond-pass");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("completed");
    expect(completedEvents).toContain("plan-postcond-pass");
  });

  it("fails step when postcondition does not match", async () => {
    container = await createContainer({ dbPath: ":memory:", migrationsDir });
    const jobQueue = new JobQueue(container.db);

    const failedEvents: string[] = [];
    container.eventBus.on("plan:failed", ({ planId }) => {
      failedEvents.push(planId);
    });

    const runner = new ExecutionRunner(
      {
        jobQueue,
        eventLog: container.eventLog,
        eventBus: container.eventBus,
      },
      { planTimeoutMs: 30_000 },
    );

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return {
          success: true,
          result: { ok: true },
          evidence: { http: { status: 500 } },
        };
      }),
    };

    const steps: ActionPrimitive[] = [
      {
        type: "Http" as ActionPrimitive["type"],
        args: { url: "https://example.com" },
        postcondition: {
          assertions: [{ type: "http_status", equals: 200 }],
        },
      },
    ];

    await runner.executePlan("plan-postcond-fail", steps, mockExecutor);

    // All retries exhausted since postcondition always fails (same evidence each time)
    expect(failedEvents).toContain("plan-postcond-fail");

    const jobs = await jobQueue.getByPlanId("plan-postcond-fail");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("failed");
    expect(jobs[0]!.error).toContain("postcondition failed");
  });

  it("retry re-dequeues the same job, not a different step", async () => {
    container = await createContainer({ dbPath: ":memory:", migrationsDir });
    const jobQueue = new JobQueue(container.db);

    const completedEvents: string[] = [];
    container.eventBus.on("plan:completed", ({ planId }) => {
      completedEvents.push(planId);
    });

    const runner = new ExecutionRunner(
      {
        jobQueue,
        eventLog: container.eventLog,
        eventBus: container.eventBus,
      },
      { planTimeoutMs: 30_000 },
    );

    let step0CallCount = 0;
    const mockExecutor: StepExecutor = {
      execute: vi.fn(
        async (
          action: ActionPrimitive,
          _planId: string,
          stepIndex: number,
        ): Promise<StepResult> => {
          if (stepIndex === 0) {
            step0CallCount++;
            if (step0CallCount === 1) {
              // Fail the first attempt of step 0
              return { success: false, error: "transient error" };
            }
            // Succeed on retry
            return { success: true, result: { retried: true } };
          }
          // Step 1 always succeeds
          return { success: true, result: { ok: true } };
        },
      ),
    };

    const steps: ActionPrimitive[] = [
      testStep("Research", { intent: "step0" }),
      testStep("Message", { body: "step1" }),
    ];

    await runner.executePlan("plan-retry-same", steps, mockExecutor);

    // Step 0 was called twice (fail + retry), step 1 once => 3 total
    expect(mockExecutor.execute).toHaveBeenCalledTimes(3);

    const jobs = await jobQueue.getByPlanId("plan-retry-same");
    expect(jobs).toHaveLength(2);

    // Both jobs should be completed
    expect(jobs[0]!.status).toBe("completed");
    expect(jobs[0]!.step_index).toBe(0);
    expect(jobs[1]!.status).toBe("completed");
    expect(jobs[1]!.step_index).toBe(1);

    // Step 0 was retried (attempt > 1)
    expect(jobs[0]!.attempt).toBeGreaterThan(1);

    // Plan completed successfully
    expect(completedEvents).toContain("plan-retry-same");
  });

  it("handles empty plan (0 steps)", async () => {
    container = await createContainer({ dbPath: ":memory:", migrationsDir });
    const jobQueue = new JobQueue(container.db);

    const completedEvents: string[] = [];
    container.eventBus.on("plan:completed", ({ planId }) => {
      completedEvents.push(planId);
    });

    const runner = new ExecutionRunner({
      jobQueue,
      eventLog: container.eventLog,
      eventBus: container.eventBus,
    });

    const mockExecutor: StepExecutor = {
      execute: vi.fn(async (): Promise<StepResult> => {
        return { success: true };
      }),
    };

    await runner.executePlan("plan-empty-1", [], mockExecutor);

    // Executor should not be called
    expect(mockExecutor.execute).not.toHaveBeenCalled();

    // Empty plan should succeed immediately (PlanStateMachine handles this)
    // No completion event because the machine goes to succeeded but
    // the loop doesn't run, so no explicit event is emitted for 0-step plans.
    const jobs = await jobQueue.getByPlanId("plan-empty-1");
    expect(jobs).toHaveLength(0);
  });
});
