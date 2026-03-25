import { describe, expect, it, vi } from "vitest";
import type { WorkboardDispatcherRepository } from "../src/index.js";
import { reconcileItemDispatchState } from "../src/dispatcher-support.js";
import { TEST_SCOPE, createLogger, makeTask, makeWorkItem } from "./test-support.js";

function createRepository(): WorkboardDispatcherRepository {
  return {
    listReadyItems: vi.fn(async () => []),
    listDoingItems: vi.fn(async () => []),
    getItem: vi.fn(async () => makeWorkItem({ status: "doing" })),
    listTasks: vi.fn(async () => []),
    createTask: vi.fn(async ({ task }) => makeTask(task)),
    updateTask: vi.fn(async () => undefined),
    leaseRunnableTasks: vi.fn(async () => ({ leased: [] })),
    transitionItem: vi.fn(async () => makeWorkItem({ status: "blocked" })),
    getStateKv: vi.fn(async () => undefined),
    setStateKv: vi.fn(async () => undefined),
    markSubagentClosed: vi.fn(async () => undefined),
    markSubagentFailed: vi.fn(async () => undefined),
    acquireExecutionSlot: vi.fn(async () => true),
    releaseExecutionSlot: vi.fn(async () => undefined),
    createSubagent: vi.fn(async () => undefined as never),
    listSubagents: vi.fn(async () => ({ subagents: [] })),
    getSubagent: vi.fn(async () => undefined),
    closeSubagent: vi.fn(async () => undefined),
    updateSubagent: vi.fn(async () => undefined),
  };
}

describe("reconcileItemDispatchState", () => {
  it("logs when it cannot block a failed item", async () => {
    const repository = createRepository();
    repository.listTasks.mockResolvedValue([
      makeTask({ status: "failed", execution_profile: "executor_rw" }),
    ]);
    repository.transitionItem.mockRejectedValue(new Error("db busy"));
    const logger = createLogger();

    await expect(
      reconcileItemDispatchState({
        repository,
        logger,
        scope: TEST_SCOPE,
        workItemId: "work-1",
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      "workboard.transition_item_failed",
      expect.objectContaining({
        context: "dispatch_state_failed_task",
        work_item_id: "work-1",
        status: "blocked",
        error: "db busy",
      }),
    );
  });
});
