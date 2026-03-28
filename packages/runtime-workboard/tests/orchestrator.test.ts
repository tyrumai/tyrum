import { describe, expect, it, vi } from "vitest";
import {
  WorkboardOrchestrator,
  type WorkboardOrchestratorRepository,
  type WorkboardSubagentRuntime,
} from "../src/index.js";
import {
  TEST_SCOPE,
  createLogger,
  makeClarification,
  makeSubagent,
  makeTask,
  makeWorkItem,
} from "./test-support.js";

const TEST_ITEM_SCOPE = {
  ...TEST_SCOPE,
  work_item_id: "work-1",
} as const;

function createRepository(): WorkboardOrchestratorRepository {
  return {
    listBacklogItems: vi.fn(async () => []),
    listPlannerSubagentsOutsideBacklog: vi.fn(async () => []),
    listClarifications: vi.fn(async () => ({ clarifications: [] })),
    getItem: vi.fn(async () => makeWorkItem()),
    transitionItem: vi.fn(async () => makeWorkItem()),
    listTasks: vi.fn(async () => []),
    createTask: vi.fn(async ({ task }) => makeTask(task)),
    updateTask: vi.fn(async () => undefined),
    leaseRunnableTasks: vi.fn(async () => ({ leased: [] })),
    getStateKv: vi.fn(async () => undefined),
    setStateKv: vi.fn(async () => undefined),
    requeueOrphanedTasks: vi.fn(async () => undefined),
    createSubagent: vi.fn(async ({ subagentId, subagent }) =>
      makeSubagent({
        subagent_id: subagentId ?? "subagent-1",
        execution_profile: subagent.execution_profile,
        conversation_key:
          subagent.conversation_key ?? `agent:default:subagent:${subagentId ?? "subagent-1"}`,
        parent_conversation_key: subagent.parent_conversation_key,
        work_item_id: subagent.work_item_id,
        work_item_task_id: subagent.work_item_task_id,
        status: subagent.status ?? "paused",
      }),
    ),
    listSubagents: vi.fn(async () => ({ subagents: [] })),
    getSubagent: vi.fn(async () => undefined),
    closeSubagent: vi.fn(async () => undefined),
    markSubagentClosed: vi.fn(async () => undefined),
    markSubagentFailed: vi.fn(async () => undefined),
    updateSubagent: vi.fn(async () => undefined),
  };
}

function createRuntime(): WorkboardSubagentRuntime {
  return {
    buildConversationKey: vi.fn(
      async (_scope, subagentId) => `agent:default:subagent:${subagentId}`,
    ),
    runTurn: vi.fn(async () => ({
      reply: "planner refinement complete",
      conversation_key: "agent:default:subagent:subagent-1",
      turn_id: "turn-1",
    })),
  };
}

describe("WorkboardOrchestrator", () => {
  it("pauses running planners when open clarifications exist", async () => {
    const repository = createRepository();
    repository.listBacklogItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listClarifications.mockResolvedValue({ clarifications: [makeClarification()] });
    repository.listSubagents.mockResolvedValue({
      subagents: [makeSubagent({ status: "running" })],
    });
    const orchestrator = new WorkboardOrchestrator({ repository, runtime: createRuntime() });

    await orchestrator.tick();

    expect(repository.updateSubagent).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      subagent_id: "subagent-1",
      patch: { status: "paused" },
    });
    expect(repository.createTask).not.toHaveBeenCalled();
  });

  it("does not update already paused planners when clarifications are open", async () => {
    const repository = createRepository();
    repository.listBacklogItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listClarifications.mockResolvedValue({ clarifications: [makeClarification()] });
    repository.listSubagents.mockResolvedValue({
      subagents: [makeSubagent({ status: "paused" })],
    });
    const orchestrator = new WorkboardOrchestrator({ repository, runtime: createRuntime() });

    await orchestrator.tick();

    expect(repository.updateSubagent).not.toHaveBeenCalled();
  });

  it("creates a planner task when no active planner task exists", async () => {
    const repository = createRepository();
    repository.listBacklogItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listSubagents.mockResolvedValue({
      subagents: [makeSubagent({ status: "paused" })],
    });
    repository.listTasks.mockResolvedValue([]);
    const orchestrator = new WorkboardOrchestrator({ repository, runtime: createRuntime() });

    await orchestrator.tick();

    expect(repository.createTask).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      task: {
        work_item_id: "work-1",
        status: "queued",
        execution_profile: "planner",
        side_effect_class: "workspace",
        result_summary: "Planner refinement task",
      },
    });
  });

  it("does not create a duplicate planner task and requeues non-planner leases", async () => {
    const repository = createRepository();
    repository.listBacklogItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listSubagents.mockResolvedValue({
      subagents: [makeSubagent({ status: "paused" })],
    });
    repository.listTasks.mockResolvedValue([makeTask({ status: "queued" })]);
    repository.leaseRunnableTasks.mockResolvedValue({
      leased: [makeTask({ task_id: "task-2", execution_profile: "executor_rw" })].map((task) => ({
        task,
      })),
    });
    const runtime = createRuntime();
    const orchestrator = new WorkboardOrchestrator({ repository, runtime });

    await orchestrator.tick();

    expect(repository.createTask).not.toHaveBeenCalled();
    expect(repository.updateTask).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      task_id: "task-2",
      lease_owner: "workboard-orchestrator:work-1",
      patch: { status: "queued" },
    });
    expect(runtime.runTurn).not.toHaveBeenCalled();
  });

  it("returns early when the work item disappears after leasing the planner task", async () => {
    const repository = createRepository();
    repository.listBacklogItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listSubagents.mockResolvedValue({
      subagents: [makeSubagent({ status: "paused" })],
    });
    repository.listTasks.mockResolvedValue([makeTask({ status: "queued" })]);
    repository.leaseRunnableTasks.mockResolvedValue({
      leased: [makeTask({ status: "leased" })].map((task) => ({ task })),
    });
    repository.getItem.mockResolvedValue(undefined);
    const runtime = createRuntime();
    const orchestrator = new WorkboardOrchestrator({ repository, runtime });

    await orchestrator.tick();

    expect(repository.updateSubagent).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      subagent_id: "subagent-1",
      patch: { status: "running" },
    });
    expect(runtime.runTurn).not.toHaveBeenCalled();
  });

  it("completes planner tasks and pauses the planner when the item stays in backlog", async () => {
    const repository = createRepository();
    repository.listBacklogItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listSubagents.mockResolvedValue({
      subagents: [makeSubagent({ status: "paused" })],
    });
    const plannerTask = makeTask({ status: "leased" });
    repository.listTasks.mockResolvedValue([makeTask({ status: "queued" })]);
    repository.leaseRunnableTasks.mockResolvedValue({ leased: [{ task: plannerTask }] });
    repository.getItem
      .mockResolvedValueOnce(makeWorkItem({ work_item_id: "work-1", status: "backlog" }))
      .mockResolvedValueOnce(makeWorkItem({ work_item_id: "work-1", status: "backlog" }));
    const runtime = createRuntime();
    runtime.runTurn = vi.fn(async () => ({
      reply: "planner reply",
      conversation_key: "agent:default:subagent:subagent-1",
      turn_id: "turn-2",
    }));
    const orchestrator = new WorkboardOrchestrator({ repository, runtime });

    await orchestrator.tick();

    expect(repository.updateTask).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      task_id: "task-1",
      lease_owner: "workboard-orchestrator:work-1",
      patch: expect.objectContaining({
        status: "completed",
        turn_id: "turn-2",
        result_summary: "planner reply",
      }),
    });
    expect(repository.updateSubagent).toHaveBeenNthCalledWith(2, {
      scope: TEST_ITEM_SCOPE,
      subagent_id: "subagent-1",
      patch: { status: "paused" },
    });
  });

  it("uses the default completion summary and closes the planner when work leaves backlog", async () => {
    const repository = createRepository();
    repository.listBacklogItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listSubagents.mockResolvedValue({
      subagents: [makeSubagent({ status: "paused" })],
    });
    const plannerTask = makeTask({ status: "leased" });
    repository.listTasks.mockResolvedValue([makeTask({ status: "queued" })]);
    repository.leaseRunnableTasks.mockResolvedValue({ leased: [{ task: plannerTask }] });
    repository.getItem
      .mockResolvedValueOnce(makeWorkItem({ work_item_id: "work-1", status: "backlog" }))
      .mockResolvedValueOnce(makeWorkItem({ work_item_id: "work-1", status: "ready" }));
    const runtime = createRuntime();
    runtime.runTurn = vi.fn(async () => ({
      reply: "",
      conversation_key: "agent:default:subagent:subagent-1",
      turn_id: "turn-3",
    }));
    const orchestrator = new WorkboardOrchestrator({ repository, runtime });

    await orchestrator.tick();

    expect(repository.updateTask).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      task_id: "task-1",
      lease_owner: "workboard-orchestrator:work-1",
      patch: expect.objectContaining({
        status: "completed",
        turn_id: "turn-3",
        result_summary: "Planner refinement turn completed.",
      }),
    });
    expect(repository.markSubagentClosed).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      subagent_id: "subagent-1",
    });
  });

  it("marks planner failures on the task and subagent and emits a warning", async () => {
    const repository = createRepository();
    repository.listBacklogItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listSubagents.mockResolvedValue({
      subagents: [makeSubagent({ status: "paused" })],
    });
    repository.listTasks.mockResolvedValue([makeTask({ status: "queued" })]);
    repository.leaseRunnableTasks.mockResolvedValue({
      leased: [makeTask({ status: "leased" })].map((task) => ({ task })),
    });
    repository.getItem.mockResolvedValue(makeWorkItem());
    const runtime = createRuntime();
    runtime.runTurn = vi.fn().mockRejectedValue(new Error("planner failed"));
    const logger = createLogger();
    const orchestrator = new WorkboardOrchestrator({ repository, runtime, logger });

    await orchestrator.tick();

    expect(repository.updateTask).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      task_id: "task-1",
      lease_owner: "workboard-orchestrator:work-1",
      patch: expect.objectContaining({
        status: "failed",
        result_summary: "planner failed",
      }),
    });
    expect(repository.markSubagentFailed).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      subagent_id: "subagent-1",
      reason: "planner failed",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "workboard.planner_turn_failed",
      expect.objectContaining({
        work_item_id: "work-1",
        subagent_id: "subagent-1",
        error: "planner failed",
      }),
    );
  });

  it("creates a planner subagent when one does not already exist", async () => {
    const repository = createRepository();
    repository.listBacklogItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listSubagents.mockResolvedValue({ subagents: [] });
    repository.getItem.mockResolvedValue(
      makeWorkItem({
        work_item_id: "work-1",
        created_from_conversation_key: "agent:default:main",
      }),
    );
    repository.listTasks.mockResolvedValue([makeTask({ status: "queued" })]);
    const runtime = createRuntime();
    const orchestrator = new WorkboardOrchestrator({ repository, runtime });

    await orchestrator.tick();

    expect(repository.createSubagent).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      subagentId: expect.any(String),
      subagent: expect.objectContaining({
        parent_conversation_key: "agent:default:main",
        work_item_id: "work-1",
        execution_profile: "planner",
        status: "paused",
        conversation_key: expect.stringMatching(/^agent:default:subagent:/),
      }),
    });
  });

  it("closes planner subagents that are outside backlog", async () => {
    const repository = createRepository();
    repository.listPlannerSubagentsOutsideBacklog.mockResolvedValue([
      { ...TEST_SCOPE, subagent_id: "subagent-1", work_item_id: "work-1" },
      { ...TEST_SCOPE, subagent_id: "subagent-2", work_item_id: "work-2" },
    ]);
    const orchestrator = new WorkboardOrchestrator({ repository, runtime: createRuntime() });

    await orchestrator.tick();

    expect(repository.markSubagentClosed).toHaveBeenCalledTimes(2);
    expect(repository.markSubagentClosed).toHaveBeenNthCalledWith(1, {
      scope: TEST_SCOPE,
      subagent_id: "subagent-1",
    });
    expect(repository.markSubagentClosed).toHaveBeenNthCalledWith(2, {
      scope: TEST_SCOPE,
      subagent_id: "subagent-2",
    });
  });
});
