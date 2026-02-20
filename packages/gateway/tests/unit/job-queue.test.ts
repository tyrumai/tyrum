import { afterEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { JobQueue } from "../../src/modules/executor/job-queue.js";
import type { ActionPrimitive } from "@tyrum/schemas";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function testAction(overrides?: Partial<ActionPrimitive>): ActionPrimitive {
  return {
    type: "Research",
    args: { intent: "test" },
    ...overrides,
  };
}

describe("JobQueue", () => {
  let container: GatewayContainer | undefined;

  afterEach(() => {
    container?.db.close();
    container = undefined;
  });

  it("enqueues a job with pending status", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    const job = queue.enqueue("plan-1", 0, testAction());

    expect(job.plan_id).toBe("plan-1");
    expect(job.step_index).toBe(0);
    expect(job.status).toBe("pending");
    expect(job.attempt).toBe(0);
    expect(job.max_attempts).toBe(3);
    expect(job.action.type).toBe("Research");
  });

  it("dequeues a pending job and marks it running", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    queue.enqueue("plan-1", 0, testAction());
    const dequeued = queue.dequeue("plan-1");

    expect(dequeued).toBeDefined();
    expect(dequeued!.status).toBe("running");
    expect(dequeued!.attempt).toBe(1);
    expect(dequeued!.started_at).toBeTruthy();
  });

  it("dequeue returns undefined when no pending jobs", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    const dequeued = queue.dequeue("plan-nonexistent");
    expect(dequeued).toBeUndefined();
  });

  it("dequeues jobs in step_index order", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    queue.enqueue("plan-1", 2, testAction({ type: "Web" }));
    queue.enqueue("plan-1", 0, testAction({ type: "Research" }));
    queue.enqueue("plan-1", 1, testAction({ type: "Message" }));

    const first = queue.dequeue("plan-1");
    expect(first!.step_index).toBe(0);
    expect(first!.action.type).toBe("Research");

    const second = queue.dequeue("plan-1");
    expect(second!.step_index).toBe(1);
    expect(second!.action.type).toBe("Message");

    const third = queue.dequeue("plan-1");
    expect(third!.step_index).toBe(2);
    expect(third!.action.type).toBe("Web");
  });

  it("markCompleted transitions to completed with result", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    const job = queue.enqueue("plan-1", 0, testAction());
    queue.dequeue("plan-1");
    queue.markCompleted(job.id, { output: "done" });

    const updated = queue.getById(job.id);
    expect(updated!.status).toBe("completed");
    expect(updated!.completed_at).toBeTruthy();
    expect(updated!.result).toEqual({ output: "done" });
  });

  it("markFailed transitions to failed with error", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    const job = queue.enqueue("plan-1", 0, testAction());
    queue.dequeue("plan-1");
    queue.markFailed(job.id, "something broke");

    const updated = queue.getById(job.id);
    expect(updated!.status).toBe("failed");
    expect(updated!.error).toBe("something broke");
    expect(updated!.completed_at).toBeTruthy();
  });

  it("markPaused transitions to paused", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    const job = queue.enqueue("plan-1", 0, testAction());
    queue.dequeue("plan-1");
    queue.markPaused(job.id);

    const updated = queue.getById(job.id);
    expect(updated!.status).toBe("paused");
  });

  it("markCancelled transitions to cancelled", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    const job = queue.enqueue("plan-1", 0, testAction());
    queue.markCancelled(job.id);

    const updated = queue.getById(job.id);
    expect(updated!.status).toBe("cancelled");
    expect(updated!.completed_at).toBeTruthy();
  });

  it("retryIfPossible resets failed job to pending", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    const job = queue.enqueue("plan-1", 0, testAction(), { maxAttempts: 3 });
    queue.dequeue("plan-1"); // attempt 1
    queue.markFailed(job.id, "error");

    const retried = queue.retryIfPossible(job.id);
    expect(retried).toBe(true);

    const updated = queue.getById(job.id);
    expect(updated!.status).toBe("pending");
    expect(updated!.error).toBeNull();
  });

  it("retryIfPossible returns false when max attempts reached", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    const job = queue.enqueue("plan-1", 0, testAction(), { maxAttempts: 1 });
    queue.dequeue("plan-1"); // attempt 1
    queue.markFailed(job.id, "error");

    const retried = queue.retryIfPossible(job.id);
    expect(retried).toBe(false);
  });

  it("cancelAllForPlan cancels pending and running jobs", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    queue.enqueue("plan-1", 0, testAction());
    queue.enqueue("plan-1", 1, testAction());
    queue.enqueue("plan-1", 2, testAction());
    queue.dequeue("plan-1"); // step 0 is running

    queue.cancelAllForPlan("plan-1");

    const jobs = queue.getByPlanId("plan-1");
    expect(jobs).toHaveLength(3);
    expect(jobs.every((j) => j.status === "cancelled")).toBe(true);
  });

  it("getByPlanId returns all jobs for a plan", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    queue.enqueue("plan-1", 0, testAction());
    queue.enqueue("plan-1", 1, testAction({ type: "Web" }));
    queue.enqueue("plan-2", 0, testAction());

    const plan1Jobs = queue.getByPlanId("plan-1");
    expect(plan1Jobs).toHaveLength(2);
    expect(plan1Jobs[0]!.step_index).toBe(0);
    expect(plan1Jobs[1]!.step_index).toBe(1);
  });

  it("dequeueById targets specific job by ID", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    const job0 = queue.enqueue("plan-1", 0, testAction({ type: "Research" }));
    const job1 = queue.enqueue("plan-1", 1, testAction({ type: "Message" }));
    const job2 = queue.enqueue("plan-1", 2, testAction({ type: "Web" }));

    // Dequeue job1 (step_index=1) specifically, skipping step_index=0
    const dequeued = queue.dequeueById(job1.id);

    expect(dequeued).toBeDefined();
    expect(dequeued!.id).toBe(job1.id);
    expect(dequeued!.step_index).toBe(1);
    expect(dequeued!.status).toBe("running");
    expect(dequeued!.attempt).toBe(1);
    expect(dequeued!.started_at).toBeTruthy();

    // Other jobs remain pending
    const remaining0 = queue.getById(job0.id);
    expect(remaining0!.status).toBe("pending");
    const remaining2 = queue.getById(job2.id);
    expect(remaining2!.status).toBe("pending");
  });

  it("dequeueById returns undefined for non-pending job", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    const job = queue.enqueue("plan-1", 0, testAction());
    // Dequeue to make it running
    queue.dequeue("plan-1");

    // Attempt to dequeueById on a now-running job
    const result = queue.dequeueById(job.id);
    expect(result).toBeUndefined();
  });

  it("dequeueById returns undefined for nonexistent ID", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    const result = queue.dequeueById("job-does-not-exist");
    expect(result).toBeUndefined();
  });

  it("respects custom maxAttempts and timeoutMs", () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });
    const queue = new JobQueue(container.db);

    const job = queue.enqueue("plan-1", 0, testAction(), {
      maxAttempts: 5,
      timeoutMs: 60_000,
    });

    expect(job.max_attempts).toBe(5);
    expect(job.timeout_ms).toBe(60_000);
  });
});
