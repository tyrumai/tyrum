import { afterEach, describe, expect, it } from "vitest";
import { JobQueue } from "../../src/modules/executor/job-queue.js";
import type { ActionPrimitive } from "@tyrum/schemas";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

function testAction(overrides?: Partial<ActionPrimitive>): ActionPrimitive {
  return {
    type: "Research",
    args: { intent: "test" },
    ...overrides,
  };
}

describe("JobQueue", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("enqueues a job with pending status", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    const job = await queue.enqueue("plan-1", 0, testAction());

    expect(job.plan_id).toBe("plan-1");
    expect(job.step_index).toBe(0);
    expect(job.status).toBe("pending");
    expect(job.attempt).toBe(0);
    expect(job.max_attempts).toBe(3);
    expect(job.action.type).toBe("Research");
  });

  it("dequeues a pending job and marks it running", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    await queue.enqueue("plan-1", 0, testAction());
    const dequeued = await queue.dequeue("plan-1");

    expect(dequeued).toBeDefined();
    expect(dequeued!.status).toBe("running");
    expect(dequeued!.attempt).toBe(1);
    expect(dequeued!.started_at).toBeTruthy();
  });

  it("dequeue returns undefined when no pending jobs", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    const dequeued = await queue.dequeue("plan-nonexistent");
    expect(dequeued).toBeUndefined();
  });

  it("dequeues jobs in step_index order", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    await queue.enqueue("plan-1", 2, testAction({ type: "Web" }));
    await queue.enqueue("plan-1", 0, testAction({ type: "Research" }));
    await queue.enqueue("plan-1", 1, testAction({ type: "Message" }));

    const first = await queue.dequeue("plan-1");
    expect(first!.step_index).toBe(0);
    expect(first!.action.type).toBe("Research");

    const second = await queue.dequeue("plan-1");
    expect(second!.step_index).toBe(1);
    expect(second!.action.type).toBe("Message");

    const third = await queue.dequeue("plan-1");
    expect(third!.step_index).toBe(2);
    expect(third!.action.type).toBe("Web");
  });

  it("markCompleted transitions to completed with result", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    const job = await queue.enqueue("plan-1", 0, testAction());
    await queue.dequeue("plan-1");
    await queue.markCompleted(job.id, { output: "done" });

    const updated = await queue.getById(job.id);
    expect(updated!.status).toBe("completed");
    expect(updated!.completed_at).toBeTruthy();
    expect(updated!.result).toEqual({ output: "done" });
  });

  it("markFailed transitions to failed with error", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    const job = await queue.enqueue("plan-1", 0, testAction());
    await queue.dequeue("plan-1");
    await queue.markFailed(job.id, "something broke");

    const updated = await queue.getById(job.id);
    expect(updated!.status).toBe("failed");
    expect(updated!.error).toBe("something broke");
    expect(updated!.completed_at).toBeTruthy();
  });

  it("markPaused transitions to paused", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    const job = await queue.enqueue("plan-1", 0, testAction());
    await queue.dequeue("plan-1");
    await queue.markPaused(job.id);

    const updated = await queue.getById(job.id);
    expect(updated!.status).toBe("paused");
  });

  it("markCancelled transitions to cancelled", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    const job = await queue.enqueue("plan-1", 0, testAction());
    await queue.markCancelled(job.id);

    const updated = await queue.getById(job.id);
    expect(updated!.status).toBe("cancelled");
    expect(updated!.completed_at).toBeTruthy();
  });

  it("retryIfPossible resets failed job to pending", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    const job = await queue.enqueue("plan-1", 0, testAction(), { maxAttempts: 3 });
    await queue.dequeue("plan-1"); // attempt 1
    await queue.markFailed(job.id, "error");

    const retried = await queue.retryIfPossible(job.id);
    expect(retried).toBe(true);

    const updated = await queue.getById(job.id);
    expect(updated!.status).toBe("pending");
    expect(updated!.error).toBeNull();
  });

  it("retryIfPossible returns false when max attempts reached", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    const job = await queue.enqueue("plan-1", 0, testAction(), { maxAttempts: 1 });
    await queue.dequeue("plan-1"); // attempt 1
    await queue.markFailed(job.id, "error");

    const retried = await queue.retryIfPossible(job.id);
    expect(retried).toBe(false);
  });

  it("cancelAllForPlan cancels pending and running jobs", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    await queue.enqueue("plan-1", 0, testAction());
    await queue.enqueue("plan-1", 1, testAction());
    await queue.enqueue("plan-1", 2, testAction());
    await queue.dequeue("plan-1"); // step 0 is running

    await queue.cancelAllForPlan("plan-1");

    const jobs = await queue.getByPlanId("plan-1");
    expect(jobs).toHaveLength(3);
    expect(jobs.every((j) => j.status === "cancelled")).toBe(true);
  });

  it("getByPlanId returns all jobs for a plan", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    await queue.enqueue("plan-1", 0, testAction());
    await queue.enqueue("plan-1", 1, testAction({ type: "Web" }));
    await queue.enqueue("plan-2", 0, testAction());

    const plan1Jobs = await queue.getByPlanId("plan-1");
    expect(plan1Jobs).toHaveLength(2);
    expect(plan1Jobs[0]!.step_index).toBe(0);
    expect(plan1Jobs[1]!.step_index).toBe(1);
  });

  it("dequeueById targets specific job by ID", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    const job0 = await queue.enqueue("plan-1", 0, testAction({ type: "Research" }));
    const job1 = await queue.enqueue("plan-1", 1, testAction({ type: "Message" }));
    const job2 = await queue.enqueue("plan-1", 2, testAction({ type: "Web" }));

    // Dequeue job1 (step_index=1) specifically, skipping step_index=0
    const dequeued = await queue.dequeueById(job1.id);

    expect(dequeued).toBeDefined();
    expect(dequeued!.id).toBe(job1.id);
    expect(dequeued!.step_index).toBe(1);
    expect(dequeued!.status).toBe("running");
    expect(dequeued!.attempt).toBe(1);
    expect(dequeued!.started_at).toBeTruthy();

    // Other jobs remain pending
    const remaining0 = await queue.getById(job0.id);
    expect(remaining0!.status).toBe("pending");
    const remaining2 = await queue.getById(job2.id);
    expect(remaining2!.status).toBe("pending");
  });

  it("dequeueById returns undefined for non-pending job", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    const job = await queue.enqueue("plan-1", 0, testAction());
    // Dequeue to make it running
    await queue.dequeue("plan-1");

    // Attempt to dequeueById on a now-running job
    const result = await queue.dequeueById(job.id);
    expect(result).toBeUndefined();
  });

  it("dequeueById returns undefined for nonexistent ID", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    const result = await queue.dequeueById("job-does-not-exist");
    expect(result).toBeUndefined();
  });

  it("respects custom maxAttempts and timeoutMs", async () => {
    db = openTestSqliteDb();
    const queue = new JobQueue(db);

    const job = await queue.enqueue("plan-1", 0, testAction(), {
      maxAttempts: 5,
      timeoutMs: 60_000,
    });

    expect(job.max_attempts).toBe(5);
    expect(job.timeout_ms).toBe(60_000);
  });
});
