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
    setStateKv: vi.fn(async () => undefined),
    requeueOrphanedTasks: vi.fn(async () => undefined),
    getItem: vi.fn(async () => makeWorkItem({ status: "doing" })),
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
    repository.listTasks.mockResolvedValue([makeTask({ status: "failed" })]);
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
    repository.listTasks.mockResolvedValue([makeTask({ status: "failed" })]);
    repository.transitionItem.mockRejectedValue(new Error("db busy"));
    const reconciler = new WorkboardReconciler({ repository });

    await expect(reconciler.tick()).resolves.toBeUndefined();
  });

  it("finalizes doing items when all tasks are completed or skipped", async () => {
    const repository = createRepository();
    repository.listDoingItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ status: "completed" }),
      makeTask({ task_id: "task-2", status: "skipped" }),
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
    repository.listTasks.mockResolvedValue([makeTask({ status: "completed" })]);
    repository.getItem.mockResolvedValue(makeWorkItem({ status: "ready" }));
    const reconciler = new WorkboardReconciler({ repository });

    await reconciler.tick();

    expect(repository.transitionItem).not.toHaveBeenCalled();
  });

  it("blocks cancelled tasks with no active subagent", async () => {
    const repository = createRepository();
    repository.listDoingItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ status: "cancelled" }),
      makeTask({ task_id: "task-2", status: "completed" }),
    ]);
    const reconciler = new WorkboardReconciler({ repository });

    await reconciler.tick();

    expect(repository.transitionItem).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      work_item_id: "work-1",
      status: "blocked",
      reason: "Execution task cancelled without an active subagent.",
    });
  });

  it("swallows failures while blocking cancelled work", async () => {
    const repository = createRepository();
    repository.listDoingItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([makeTask({ status: "cancelled" })]);
    repository.transitionItem.mockRejectedValue(new Error("db busy"));
    const reconciler = new WorkboardReconciler({ repository });

    await expect(reconciler.tick()).resolves.toBeUndefined();
  });

  it("requeues orphaned work when no tasks exist", async () => {
    const repository = createRepository();
    repository.listDoingItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([]);
    const reconciler = new WorkboardReconciler({ repository });

    await reconciler.tick();

    expect(repository.requeueOrphanedTasks).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      work_item_id: "work-1",
      updated_at: expect.any(String),
    });
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
      reason: "Automatically requeued orphaned execution work.",
    });
  });

  it("requeues orphaned work for queued, leased, running, and paused tasks", async () => {
    const repository = createRepository();
    repository.listDoingItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ status: "queued" }),
      makeTask({ task_id: "task-2", status: "leased" }),
      makeTask({ task_id: "task-3", status: "running" }),
      makeTask({ task_id: "task-4", status: "paused" }),
    ]);
    const reconciler = new WorkboardReconciler({ repository });

    await reconciler.tick();

    expect(repository.requeueOrphanedTasks).toHaveBeenCalledOnce();
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
    repository.listTasks.mockResolvedValue([makeTask({ status: "running" })]);
    repository.transitionItem.mockRejectedValue(new Error("db busy"));
    const reconciler = new WorkboardReconciler({ repository });

    await expect(reconciler.tick()).resolves.toBeUndefined();
    expect(repository.requeueOrphanedTasks).toHaveBeenCalledOnce();
    expect(repository.setStateKv).toHaveBeenCalledOnce();
  });
});
