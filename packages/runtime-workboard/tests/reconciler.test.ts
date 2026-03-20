import { describe, expect, it, vi } from "vitest";
import { WorkboardReconciler, type WorkboardReconcilerRepository } from "../src/index.js";
import { TEST_SCOPE, makeSubagent, makeTask, makeWorkItem } from "./test-support.js";

const TEST_ITEM_SCOPE = {
  ...TEST_SCOPE,
  work_item_id: "work-1",
} as const;

function createRepository(): WorkboardReconcilerRepository {
  return {
    listDoingItems: vi.fn(async () => []),
    listSubagents: vi.fn(async () => ({ subagents: [] })),
    listTasks: vi.fn(async () => []),
    transitionItem: vi.fn(async () => makeWorkItem({ status: "ready" })),
    updateTask: vi.fn(async () => undefined),
    setStateKv: vi.fn(async () => undefined),
    requeueOrphanedTasks: vi.fn(async () => undefined),
    getItem: vi.fn(async () => makeWorkItem({ status: "doing" })),
    getStateKv: vi.fn(async () => undefined),
    createInterventionApproval: vi.fn(async () => undefined),
  };
}

describe("WorkboardReconciler", () => {
  it("does nothing when active subagents still exist", async () => {
    const repository = createRepository();
    repository.listDoingItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listSubagents.mockResolvedValue({
      subagents: [makeSubagent({ status: "running" })],
    });
    const reconciler = new WorkboardReconciler({ repository });

    await reconciler.tick();

    expect(repository.listTasks).not.toHaveBeenCalled();
    expect(repository.transitionItem).not.toHaveBeenCalled();
  });

  it("blocks work when a failed task has no active subagent", async () => {
    const repository = createRepository();
    repository.listDoingItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ status: "failed", execution_profile: "executor_rw" }),
    ]);
    const reconciler = new WorkboardReconciler({ repository });

    await reconciler.tick();

    expect(repository.transitionItem).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      work_item_id: "work-1",
      status: "blocked",
      reason: "Execution task failed without an active subagent.",
    });
  });

  it("swallows failures while trying to block failed work", async () => {
    const repository = createRepository();
    repository.listDoingItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ status: "failed", execution_profile: "executor_rw" }),
    ]);
    repository.transitionItem.mockRejectedValue(new Error("db busy"));
    const reconciler = new WorkboardReconciler({ repository });

    await expect(reconciler.tick()).resolves.toBeUndefined();
  });

  it("finalizes doing items when all tasks are completed or skipped", async () => {
    const repository = createRepository();
    repository.listDoingItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ status: "completed", execution_profile: "executor_rw" }),
      makeTask({ task_id: "task-2", status: "skipped", execution_profile: "executor_rw" }),
    ]);
    repository.getItem.mockResolvedValue(makeWorkItem({ status: "doing" }));
    const reconciler = new WorkboardReconciler({ repository });

    await reconciler.tick();

    expect(repository.transitionItem).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      work_item_id: "work-1",
      status: "done",
      reason: "All execution tasks completed.",
    });
  });

  it("does not transition non-doing items during finalization", async () => {
    const repository = createRepository();
    repository.listDoingItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ status: "completed", execution_profile: "executor_rw" }),
    ]);
    repository.getItem.mockResolvedValue(makeWorkItem({ status: "ready" }));
    const reconciler = new WorkboardReconciler({ repository });

    await reconciler.tick();

    expect(repository.transitionItem).not.toHaveBeenCalled();
  });

  it("blocks cancelled tasks with no active subagent", async () => {
    const repository = createRepository();
    repository.listDoingItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ status: "cancelled", execution_profile: "executor_rw" }),
      makeTask({ task_id: "task-2", status: "cancelled", execution_profile: "executor_rw" }),
    ]);
    const reconciler = new WorkboardReconciler({ repository });

    await reconciler.tick();

    expect(repository.transitionItem).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      work_item_id: "work-1",
      status: "blocked",
      reason: "Execution work was cancelled without an active subagent.",
    });
  });

  it("swallows failures while blocking cancelled work", async () => {
    const repository = createRepository();
    repository.listDoingItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ status: "cancelled", execution_profile: "executor_rw" }),
    ]);
    repository.transitionItem.mockRejectedValue(new Error("db busy"));
    const reconciler = new WorkboardReconciler({ repository });

    await expect(reconciler.tick()).resolves.toBeUndefined();
  });

  it("returns work to ready when execution tasks are missing", async () => {
    const repository = createRepository();
    repository.listDoingItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([]);
    const reconciler = new WorkboardReconciler({ repository });

    await reconciler.tick();

    expect(repository.requeueOrphanedTasks).not.toHaveBeenCalled();
    expect(repository.setStateKv).toHaveBeenCalledWith({
      scope: { kind: "work_item", ...TEST_ITEM_SCOPE },
      key: "work.dispatch.phase",
      value_json: "unassigned",
      provenance_json: { source: "workboard.reconciler" },
    });
    expect(repository.transitionItem).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      work_item_id: "work-1",
      status: "ready",
      reason: "Execution work is missing and must be redispatched.",
    });
  });

  it("requeues orphaned work for leased, running, and paused tasks", async () => {
    const repository = createRepository();
    repository.listDoingItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ status: "leased", execution_profile: "executor_rw" }),
      makeTask({ task_id: "task-2", status: "running", execution_profile: "executor_rw" }),
      makeTask({ task_id: "task-3", status: "paused", execution_profile: "executor_rw" }),
    ]);
    const reconciler = new WorkboardReconciler({ repository });

    await reconciler.tick();

    expect(repository.requeueOrphanedTasks).toHaveBeenCalledOnce();
    expect(repository.setStateKv).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "work.dispatch.phase",
        value_json: "unassigned",
      }),
    );
    expect(repository.transitionItem).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      work_item_id: "work-1",
      status: "ready",
      reason: "Automatically requeued orphaned execution work.",
    });
  });

  it("swallows transition failures while requeueing orphaned work", async () => {
    const repository = createRepository();
    repository.listDoingItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ status: "running", execution_profile: "executor_rw" }),
    ]);
    repository.transitionItem.mockRejectedValue(new Error("db busy"));
    const reconciler = new WorkboardReconciler({ repository });

    await expect(reconciler.tick()).resolves.toBeUndefined();
    expect(repository.requeueOrphanedTasks).toHaveBeenCalledOnce();
    expect(repository.setStateKv).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "work.dispatch.phase",
        value_json: "unassigned",
      }),
    );
  });
});
