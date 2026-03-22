import { describe, expect, it, vi } from "vitest";
import {
  WorkboardDispatcher,
  type ManagedDesktopProvisioner,
  type WorkboardDispatcherRepository,
  type WorkboardSubagentRuntime,
} from "../src/index.js";
import { TEST_SCOPE, createLogger, makeSubagent, makeTask, makeWorkItem } from "./test-support.js";

const TEST_ITEM_SCOPE = {
  ...TEST_SCOPE,
  work_item_id: "work-1",
} as const;

function createRepository(): WorkboardDispatcherRepository {
  return {
    listReadyItems: vi.fn(async () => []),
    listDoingItems: vi.fn(async () => []),
    getItem: vi.fn(async () => makeWorkItem({ status: "ready" })),
    listTasks: vi.fn(async () => []),
    createTask: vi.fn(async ({ task }) => makeTask(task)),
    updateTask: vi.fn(async () => undefined),
    leaseRunnableTasks: vi.fn(async () => ({ leased: [] })),
    transitionItem: vi.fn(async () => makeWorkItem({ status: "doing" })),
    getStateKv: vi.fn(async () => undefined),
    setStateKv: vi.fn(async () => undefined),
    markSubagentClosed: vi.fn(async () => undefined),
    markSubagentFailed: vi.fn(async () => undefined),
    acquireExecutionSlot: vi.fn(async () => true),
    releaseExecutionSlot: vi.fn(async () => undefined),
    createSubagent: vi.fn(async ({ subagentId, subagent }) =>
      makeSubagent({
        subagent_id: subagentId ?? "subagent-1",
        execution_profile: subagent.execution_profile,
        session_key: subagent.session_key ?? `agent:default:subagent:${subagentId ?? "subagent-1"}`,
        parent_session_key: subagent.parent_session_key,
        work_item_id: subagent.work_item_id,
        work_item_task_id: subagent.work_item_task_id,
        lane: subagent.lane ?? "subagent",
        status: subagent.status ?? "running",
        desktop_environment_id: subagent.desktop_environment_id,
        attached_node_id: subagent.attached_node_id,
      }),
    ),
    listSubagents: vi.fn(async () => ({ subagents: [] })),
    getSubagent: vi.fn(async () => undefined),
    closeSubagent: vi.fn(async () => undefined),
    updateSubagent: vi.fn(async () => undefined),
  };
}

function createRuntime(): WorkboardSubagentRuntime {
  return {
    buildSessionKey: vi.fn(async (_scope, subagentId) => `agent:default:subagent:${subagentId}`),
    runTurn: vi.fn(async () => "executor complete"),
  };
}

describe("WorkboardDispatcher", () => {
  it("continues scanning until it finds a ready item it can dispatch", async () => {
    const repository = createRepository();
    repository.listReadyItems.mockResolvedValue([
      { ...TEST_SCOPE, work_item_id: "work-missing" },
      { ...TEST_SCOPE, work_item_id: "work-blocked" },
      { ...TEST_SCOPE, work_item_id: "work-ready" },
    ]);
    repository.getItem
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(makeWorkItem({ work_item_id: "work-blocked", status: "blocked" }))
      .mockResolvedValueOnce(makeWorkItem({ work_item_id: "work-ready", status: "ready" }))
      .mockResolvedValueOnce(makeWorkItem({ work_item_id: "work-ready", status: "doing" }));
    repository.listTasks
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeTask({
          work_item_id: "work-ready",
          status: "leased",
          execution_profile: "executor_rw",
        }),
      ])
      .mockResolvedValueOnce([
        makeTask({
          work_item_id: "work-ready",
          status: "completed",
          execution_profile: "executor_rw",
        }),
      ]);
    repository.leaseRunnableTasks.mockResolvedValue({
      leased: [
        {
          task: makeTask({
            work_item_id: "work-ready",
            status: "leased",
            execution_profile: "executor_rw",
          }),
        },
      ],
    });
    const runtime = createRuntime();
    const dispatcher = new WorkboardDispatcher({ repository, runtime });

    await dispatcher.tick();

    expect(repository.transitionItem).toHaveBeenCalledWith({
      scope: { ...TEST_SCOPE, work_item_id: "work-ready" },
      work_item_id: "work-ready",
      status: "doing",
      reason: "Auto-dispatched to executor.",
    });
    await vi.waitFor(() => {
      expect(runtime.runTurn).toHaveBeenCalledOnce();
    });
  });

  it("creates a default execution task when none exist", async () => {
    const repository = createRepository();
    repository.listReadyItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([]);
    const dispatcher = new WorkboardDispatcher({ repository, runtime: createRuntime() });

    await dispatcher.tick();

    expect(repository.createTask).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      task: {
        work_item_id: "work-1",
        status: "queued",
        execution_profile: "executor_rw",
        side_effect_class: "workspace",
        result_summary: "Default execution task",
      },
    });
  });

  it("does not create a duplicate task when an active execution task exists", async () => {
    const repository = createRepository();
    repository.listReadyItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ execution_profile: "executor_rw", status: "running" }),
    ]);
    const dispatcher = new WorkboardDispatcher({ repository, runtime: createRuntime() });

    await dispatcher.tick();

    expect(repository.createTask).not.toHaveBeenCalled();
  });

  it("replaces only terminal failed execution tasks", async () => {
    const repository = createRepository();
    repository.listReadyItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ execution_profile: "executor_rw", status: "failed" }),
    ]);
    const dispatcher = new WorkboardDispatcher({ repository, runtime: createRuntime() });

    await dispatcher.tick();

    expect(repository.createTask).toHaveBeenCalledOnce();
  });

  it("does not replace successful execution tasks", async () => {
    const repository = createRepository();
    repository.listReadyItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ execution_profile: "executor_rw", status: "completed" }),
    ]);
    const dispatcher = new WorkboardDispatcher({ repository, runtime: createRuntime() });

    await dispatcher.tick();

    expect(repository.createTask).not.toHaveBeenCalled();
  });

  it("requeues non-selected leases and returns when no execution task is leased", async () => {
    const repository = createRepository();
    repository.listReadyItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ execution_profile: "executor_rw", status: "queued" }),
    ]);
    repository.leaseRunnableTasks.mockResolvedValue({
      leased: [
        {
          task: makeTask({ task_id: "planner-1", execution_profile: "planner", status: "leased" }),
        },
      ],
    });
    const runtime = createRuntime();
    const dispatcher = new WorkboardDispatcher({ repository, runtime });

    await dispatcher.tick();

    expect(repository.updateTask).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      task_id: "planner-1",
      lease_owner: "workboard-dispatcher:work-1",
      patch: { status: "queued" },
    });
    expect(runtime.runTurn).not.toHaveBeenCalled();
  });

  it("requeues the execution task when transitioning the item to doing fails", async () => {
    const repository = createRepository();
    repository.listReadyItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ execution_profile: "executor_rw", status: "queued" }),
    ]);
    repository.leaseRunnableTasks.mockResolvedValue({
      leased: [{ task: makeTask({ execution_profile: "executor_rw", status: "leased" }) }],
    });
    repository.transitionItem.mockRejectedValue(new Error("transition failed"));
    const runtime = createRuntime();
    const dispatcher = new WorkboardDispatcher({ repository, runtime });

    await dispatcher.tick();

    expect(repository.updateTask).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      task_id: "task-1",
      lease_owner: "workboard-dispatcher:work-1",
      patch: { status: "queued" },
    });
    expect(runtime.runTurn).not.toHaveBeenCalled();
  });

  it("provisions desktops when requested and includes the attached node in the instruction", async () => {
    const repository = createRepository();
    repository.listReadyItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks
      .mockResolvedValueOnce([makeTask({ execution_profile: "integrator", status: "queued" })])
      .mockResolvedValueOnce([makeTask({ execution_profile: "integrator", status: "leased" })])
      .mockResolvedValueOnce([makeTask({ execution_profile: "integrator", status: "completed" })]);
    repository.leaseRunnableTasks.mockResolvedValue({
      leased: [{ task: makeTask({ execution_profile: "integrator", status: "leased" }) }],
    });
    repository.getStateKv.mockResolvedValue({ value_json: true });
    repository.getItem
      .mockResolvedValueOnce(makeWorkItem({ status: "ready" }))
      .mockResolvedValueOnce(makeWorkItem({ status: "doing" }));
    const runtime = createRuntime();
    const desktopProvisioner: ManagedDesktopProvisioner = {
      provisionManagedDesktop: vi.fn(async () => ({
        desktopEnvironmentId: "desktop-1",
        attachedNodeId: "node-1",
      })),
    };
    const dispatcher = new WorkboardDispatcher({
      repository,
      runtime,
      desktopProvisioner,
    });

    await dispatcher.tick();

    await vi.waitFor(() => {
      expect(desktopProvisioner.provisionManagedDesktop).toHaveBeenCalledWith({
        tenantId: TEST_SCOPE.tenant_id,
        subagentSessionKey: expect.stringContaining("agent:default:subagent:"),
        subagentLane: "subagent",
        label: "executor:work-1",
      });
    });
    expect(repository.createSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: TEST_ITEM_SCOPE,
        subagentId: expect.any(String),
        subagent: expect.objectContaining({
          execution_profile: "executor_rw",
          desktop_environment_id: "desktop-1",
          attached_node_id: "node-1",
        }),
      }),
    );
    expect(runtime.runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Managed desktop attachment: attached_node_id=node-1 exclusive_control=true",
        ),
      }),
    );
  });

  it("dispatches without attachments when desktop provisioning is unavailable", async () => {
    const repository = createRepository();
    repository.listReadyItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks
      .mockResolvedValueOnce([makeTask({ execution_profile: "executor_rw", status: "queued" })])
      .mockResolvedValueOnce([makeTask({ execution_profile: "executor_rw", status: "leased" })])
      .mockResolvedValueOnce([makeTask({ execution_profile: "executor_rw", status: "completed" })]);
    repository.leaseRunnableTasks.mockResolvedValue({
      leased: [{ task: makeTask({ execution_profile: "executor_rw", status: "leased" }) }],
    });
    repository.getStateKv.mockResolvedValue({ value_json: true });
    repository.getItem
      .mockResolvedValueOnce(makeWorkItem({ status: "ready" }))
      .mockResolvedValueOnce(makeWorkItem({ status: "doing" }));
    const runtime = createRuntime();
    runtime.runTurn = vi.fn(async () => "");
    const dispatcher = new WorkboardDispatcher({ repository, runtime });

    await dispatcher.tick();

    await vi.waitFor(() => {
      expect(repository.createSubagent).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: TEST_ITEM_SCOPE,
          subagentId: expect.any(String),
          subagent: expect.objectContaining({
            desktop_environment_id: undefined,
            attached_node_id: undefined,
          }),
        }),
      );
    });
    expect(runtime.runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.not.stringContaining("managed desktop node"),
      }),
    );
    expect(repository.updateTask).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      task_id: "task-1",
      patch: expect.objectContaining({
        status: "completed",
        result_summary: "Executor task completed.",
      }),
    });
  });

  it("marks execution failures, attempts to block the item, and swallows block-transition errors", async () => {
    const repository = createRepository();
    repository.listReadyItems.mockResolvedValue([{ ...TEST_SCOPE, work_item_id: "work-1" }]);
    repository.listTasks.mockResolvedValue([
      makeTask({ execution_profile: "executor_rw", status: "queued" }),
    ]);
    repository.leaseRunnableTasks.mockResolvedValue({
      leased: [{ task: makeTask({ execution_profile: "executor_rw", status: "leased" }) }],
    });
    repository.transitionItem
      .mockResolvedValueOnce(makeWorkItem({ status: "doing" }))
      .mockRejectedValueOnce(new Error("block failed"));
    const runtime = createRuntime();
    runtime.runTurn = vi.fn().mockRejectedValue(new Error("executor failed"));
    const logger = createLogger();
    const dispatcher = new WorkboardDispatcher({ repository, runtime, logger });

    await dispatcher.tick();

    await vi.waitFor(() => {
      expect(repository.markSubagentFailed).toHaveBeenCalledWith({
        scope: TEST_ITEM_SCOPE,
        subagent_id: expect.any(String),
        reason: "executor failed",
      });
    });
    expect(repository.updateTask).toHaveBeenCalledWith({
      scope: TEST_ITEM_SCOPE,
      task_id: "task-1",
      patch: expect.objectContaining({
        status: "failed",
        result_summary: "executor failed",
      }),
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "workboard.executor_turn_failed",
      expect.objectContaining({
        work_item_id: "work-1",
        task_id: "task-1",
        error: "executor failed",
      }),
    );
  });
});
