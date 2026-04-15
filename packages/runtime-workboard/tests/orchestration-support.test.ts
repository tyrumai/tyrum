import { describe, expect, it, vi } from "vitest";
import {
  buildExecutorInstruction,
  buildPlannerInstruction,
  maybeFinalizeWorkItem,
  type WorkboardRepository,
} from "../src/index.js";
import { TEST_SCOPE, makeTask, makeWorkItem } from "./test-support.js";

function createRepository() {
  return {
    getItem: vi.fn(),
    listTasks: vi.fn(),
    transitionItem: vi.fn(),
  } satisfies Pick<WorkboardRepository, "getItem" | "listTasks" | "transitionItem">;
}

describe("buildPlannerInstruction", () => {
  it("includes the work item identity and planning guidance", () => {
    const instruction = buildPlannerInstruction(makeWorkItem({ work_item_id: "work-42" }));

    expect(instruction).toContain("You own refinement for WorkItem work-42: Ship runtime split");
    expect(instruction).toContain(
      "Current work item snapshot: status=backlog priority=1 acceptance=undefined",
    );
    expect(instruction).toContain("Runtime-managed bookkeeping already handles planner task creation");
    expect(instruction).toContain("Use workboard.item.transition to mark the work item ready");
    expect(instruction).toContain("Request clarification through workboard.clarification.request");
    expect(instruction).toContain("Use subagent.spawn only for bounded read-only helper analysis");
  });
});

describe("buildExecutorInstruction", () => {
  it("includes the work item and task identity", () => {
    const instruction = buildExecutorInstruction({
      item: makeWorkItem({ work_item_id: "work-42" }),
      task: makeTask({ task_id: "task-42", execution_profile: "executor_rw" }),
      tasks: [makeTask({ task_id: "task-42", execution_profile: "executor_rw" })],
    });

    expect(instruction).toContain("You own execution for WorkItem work-42: Ship runtime split");
    expect(instruction).toContain("Task task-42 profile=executor_rw");
    expect(instruction).toContain("Runtime-managed bookkeeping already tracks task state");
    expect(instruction).toContain(
      "Focus on completing the assigned work with the available execution tools",
    );
    expect(instruction).not.toContain("Managed desktop attachment:");
  });

  it("includes the attached node when one is present", () => {
    const instruction = buildExecutorInstruction({
      item: makeWorkItem(),
      task: makeTask(),
      tasks: [makeTask()],
      attachedNodeId: "node-7",
    });

    expect(instruction).toContain("Managed desktop attachment: attached_node_id=node-7");
    expect(instruction).toContain("exclusive_control=true");
  });

  it("includes the current item and task graph snapshot when resuming work", () => {
    const instruction = buildExecutorInstruction({
      item: makeWorkItem({
        work_item_id: "work-1",
        title: "Ship dependency-aware dispatch",
        status: "blocked",
        priority: 3,
        acceptance: { done: true },
      }),
      task: makeTask({
        task_id: "task-2",
        status: "paused",
        execution_profile: "executor_rw",
        depends_on: ["task-1"],
      }),
      tasks: [
        makeTask({
          task_id: "task-1",
          status: "completed",
          execution_profile: "executor_ro",
        }),
        makeTask({
          task_id: "task-2",
          status: "paused",
          execution_profile: "executor_rw",
          depends_on: ["task-1"],
        }),
      ],
      resumed: true,
    });

    expect(instruction).toContain("This task was paused and resumed.");
    expect(instruction).toContain(
      'Current work item snapshot: status=blocked priority=3 acceptance={"done":true}',
    );
    expect(instruction).toContain("Current task graph snapshot:");
    expect(instruction).toContain("- task-1: status=completed profile=executor_ro depends_on=none");
    expect(instruction).toContain(
      "- task-2: status=paused profile=executor_rw depends_on=task-1 current_task=yes",
    );
    expect(instruction).toContain(
      "Operator edits may have changed prior assumptions. Treat this snapshot as authoritative before continuing.",
    );
  });
});

describe("maybeFinalizeWorkItem", () => {
  it("does nothing when there are no tasks", async () => {
    const repository = createRepository();
    repository.listTasks.mockResolvedValue([]);

    await maybeFinalizeWorkItem({
      repository,
      scope: TEST_SCOPE,
      workItemId: "work-1",
    });

    expect(repository.getItem).not.toHaveBeenCalled();
    expect(repository.transitionItem).not.toHaveBeenCalled();
  });

  it("does nothing when execution tasks are incomplete", async () => {
    const repository = createRepository();
    repository.listTasks.mockResolvedValue([makeTask({ status: "running" })]);

    await maybeFinalizeWorkItem({
      repository,
      scope: TEST_SCOPE,
      workItemId: "work-1",
    });

    expect(repository.getItem).not.toHaveBeenCalled();
    expect(repository.transitionItem).not.toHaveBeenCalled();
  });

  it("transitions doing items to done when all tasks are completed or skipped", async () => {
    const repository = createRepository();
    repository.listTasks.mockResolvedValue([
      makeTask({ status: "completed", execution_profile: "executor_rw" }),
      makeTask({ task_id: "task-2", status: "skipped", execution_profile: "executor_rw" }),
    ]);
    repository.getItem.mockResolvedValue(makeWorkItem({ status: "doing" }));

    await maybeFinalizeWorkItem({
      repository,
      scope: TEST_SCOPE,
      workItemId: "work-1",
    });

    expect(repository.transitionItem).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      work_item_id: "work-1",
      status: "done",
      reason: "All execution tasks completed.",
    });
  });

  it("does not transition non-doing items", async () => {
    const repository = createRepository();
    repository.listTasks.mockResolvedValue([
      makeTask({ status: "completed", execution_profile: "executor_rw" }),
    ]);
    repository.getItem.mockResolvedValue(makeWorkItem({ status: "ready" }));

    await maybeFinalizeWorkItem({
      repository,
      scope: TEST_SCOPE,
      workItemId: "work-1",
    });

    expect(repository.transitionItem).not.toHaveBeenCalled();
  });
});
