import { describe, expect, it, vi } from "vitest";
import { WorkboardService } from "../src/index.js";
import { TEST_SCOPE, makeSubagent, makeTask, makeWorkItem } from "./test-support.js";

function createRepository() {
  return {
    createItem: vi.fn(),
    listItems: vi.fn(),
    getItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    transitionItem: vi.fn(),
    createLink: vi.fn(),
    listLinks: vi.fn(),
    listArtifacts: vi.fn(),
    getArtifact: vi.fn(),
    createArtifact: vi.fn(),
    listDecisions: vi.fn(),
    getDecision: vi.fn(),
    createDecision: vi.fn(),
    listSignals: vi.fn(),
    getSignal: vi.fn(),
    createSignal: vi.fn(),
    updateSignal: vi.fn(),
    getStateKv: vi.fn(),
    listStateKv: vi.fn(),
    setStateKv: vi.fn(),
    listTaskRows: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    listSubagents: vi.fn(),
    updateSubagent: vi.fn(),
    closeSubagent: vi.fn(),
    markSubagentClosed: vi.fn(),
  };
}

function createEffects() {
  return {
    emitItemEvent: vi.fn(async () => undefined),
    notifyItemTransition: vi.fn(async () => undefined),
    interruptSubagents: vi.fn(async () => undefined),
    clearSubagentSignals: vi.fn(async () => undefined),
    resolvePendingInterventionApprovals: vi.fn(async () => undefined),
    loadDeleteEffects: vi.fn(async () => ({
      childItemIds: [],
      attachedSignalIds: [],
    })),
    emitDeleteEffects: vi.fn(async () => undefined),
  };
}

describe("WorkboardService operator actions", () => {
  it("pauses active execution and blocks doing work items", async () => {
    const repository = createRepository();
    const effects = createEffects();
    const item = makeWorkItem({ status: "doing" });
    const runningTask = {
      task_id: "task-running",
      status: "running" as const,
      execution_profile: "executor_rw",
      lease_owner: "lease-owner-1",
      approval_id: "approval-1",
    };
    const runningSubagent = makeSubagent({
      subagent_id: "subagent-running",
      work_item_id: item.work_item_id,
      execution_profile: "executor_rw",
      status: "running",
    });
    const blockedItem = makeWorkItem({ work_item_id: item.work_item_id, status: "blocked" });

    repository.getItem.mockResolvedValue(item);
    repository.listTaskRows.mockResolvedValueOnce([runningTask]).mockResolvedValueOnce([
      {
        ...runningTask,
        status: "paused",
        lease_owner: undefined,
        approval_id: undefined,
      },
    ]);
    repository.listSubagents
      .mockResolvedValueOnce({ subagents: [runningSubagent] })
      .mockResolvedValueOnce({ subagents: [] });
    repository.updateTask.mockResolvedValue(makeTask({ status: "paused" }));
    repository.updateSubagent.mockResolvedValue(
      makeSubagent({ subagent_id: runningSubagent.subagent_id, status: "paused" }),
    );
    repository.setStateKv.mockResolvedValue({
      key: "work.dispatch.phase",
      value_json: "awaiting_human",
      provenance_json: { source: "work.pause" },
      updated_at: "2026-03-19T00:00:00.000Z",
    });
    repository.transitionItem.mockResolvedValue(blockedItem);

    const service = new WorkboardService({ repository, effects });

    await expect(
      service.pauseItem({
        scope: TEST_SCOPE,
        work_item_id: item.work_item_id,
        reason: "Paused for operator review.",
      }),
    ).resolves.toBe(blockedItem);

    expect(effects.interruptSubagents).toHaveBeenCalledWith({
      subagents: [runningSubagent],
      detail: "Paused for operator review.",
      createdAtMs: expect.any(Number),
    });
    expect(repository.updateSubagent).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      subagent_id: runningSubagent.subagent_id,
      patch: { status: "paused" },
    });
    expect(repository.updateTask).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      task_id: runningTask.task_id,
      lease_owner: "lease-owner-1",
      patch: {
        status: "paused",
        approval_id: null,
        pause_reason: "manual",
        pause_detail: "Paused for operator review.",
        result_summary: "Paused for operator review.",
      },
    });
    expect(repository.setStateKv).toHaveBeenCalledWith({
      scope: { kind: "work_item", ...TEST_SCOPE, work_item_id: item.work_item_id },
      key: "work.dispatch.phase",
      value_json: "awaiting_human",
      provenance_json: { source: "work.pause" },
    });
    expect(repository.transitionItem).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      work_item_id: item.work_item_id,
      status: "blocked",
      reason: "Paused for operator review.",
    });
    expect(effects.emitItemEvent).toHaveBeenCalledWith({
      type: "work.item.blocked",
      item: blockedItem,
    });
    expect(effects.notifyItemTransition).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      item: blockedItem,
    });
  });

  it("resumes blocked work, clears pause metadata, and approves pending interventions", async () => {
    const repository = createRepository();
    const effects = createEffects();
    const blockedItem = makeWorkItem({ status: "blocked" });
    const pausedTask = {
      task_id: "task-paused",
      status: "paused" as const,
      execution_profile: "executor_rw",
      approval_id: "approval-2",
    };
    const readyItem = makeWorkItem({ work_item_id: blockedItem.work_item_id, status: "ready" });

    repository.getItem.mockResolvedValue(blockedItem);
    repository.listTaskRows.mockResolvedValue([pausedTask]);
    repository.listSubagents.mockResolvedValue({ subagents: [] });
    repository.updateTask.mockResolvedValue(
      makeTask({ task_id: pausedTask.task_id, status: "queued" }),
    );
    repository.setStateKv.mockResolvedValue({
      key: "work.dispatch.phase",
      value_json: "unassigned",
      provenance_json: { source: "work.resume" },
      updated_at: "2026-03-19T00:00:00.000Z",
    });
    repository.transitionItem.mockResolvedValue(readyItem);

    const service = new WorkboardService({ repository, effects });

    await expect(
      service.resumeItem({
        scope: TEST_SCOPE,
        work_item_id: blockedItem.work_item_id,
        reason: "Resume after review",
      }),
    ).resolves.toBe(readyItem);

    expect(repository.updateTask).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      task_id: pausedTask.task_id,
      patch: {
        status: "queued",
        approval_id: null,
        pause_reason: null,
        pause_detail: null,
        result_summary: "Resume after review",
      },
    });
    expect(repository.setStateKv).toHaveBeenCalledWith({
      scope: { kind: "work_item", ...TEST_SCOPE, work_item_id: blockedItem.work_item_id },
      key: "work.dispatch.phase",
      value_json: "unassigned",
      provenance_json: { source: "work.resume" },
    });
    expect(repository.transitionItem).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      work_item_id: blockedItem.work_item_id,
      status: "ready",
      reason: "Resume after review",
    });
    expect(effects.resolvePendingInterventionApprovals).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      work_item_id: blockedItem.work_item_id,
      decision: "approved",
      reason: "Resume after review",
    });
  });

  it("deletes work items after cancelling active execution and emitting follow-up effects", async () => {
    const repository = createRepository();
    const effects = createEffects();
    const item = makeWorkItem({ status: "doing" });
    const runningTask = {
      task_id: "task-delete-running",
      status: "leased" as const,
      execution_profile: "executor_rw",
      lease_owner: "delete-owner",
    };
    const runningSubagent = makeSubagent({
      subagent_id: "subagent-delete-running",
      work_item_id: item.work_item_id,
      execution_profile: "executor_rw",
      status: "running",
    });
    const attachedSignals = {
      signals: [
        {
          signal_id: "signal-1",
          tenant_id: TEST_SCOPE.tenant_id,
          agent_id: TEST_SCOPE.agent_id,
          workspace_id: TEST_SCOPE.workspace_id,
          work_item_id: item.work_item_id,
          kind: "clarification" as const,
          status: "active" as const,
          summary: "Need review",
          created_at: "2026-03-19T00:00:00.000Z",
          updated_at: "2026-03-19T00:00:00.000Z",
        },
      ],
    };

    repository.listTaskRows.mockResolvedValue([runningTask]);
    repository.listSubagents
      .mockResolvedValueOnce({ subagents: [runningSubagent] })
      .mockResolvedValueOnce({ subagents: [] });
    repository.listSignals.mockResolvedValue(attachedSignals);
    repository.updateTask.mockResolvedValue(
      makeTask({ task_id: runningTask.task_id, status: "cancelled" }),
    );
    repository.closeSubagent.mockResolvedValue(
      makeSubagent({ subagent_id: runningSubagent.subagent_id, status: "closed" }),
    );
    repository.markSubagentClosed.mockResolvedValue(
      makeSubagent({ subagent_id: runningSubagent.subagent_id, status: "closed" }),
    );
    repository.updateSignal.mockResolvedValue({
      changed: true,
      signal: attachedSignals.signals[0],
    });
    repository.deleteItem.mockResolvedValue(item);
    effects.loadDeleteEffects.mockResolvedValue({
      childItemIds: ["work-child-1"],
      attachedSignalIds: ["signal-1"],
    });

    const service = new WorkboardService({ repository, effects });

    await expect(
      service.deleteItem({
        scope: TEST_SCOPE,
        work_item_id: item.work_item_id,
      }),
    ).resolves.toBe(item);

    expect(effects.interruptSubagents).toHaveBeenCalledWith({
      subagents: [runningSubagent],
      detail: "Deleted by operator.",
      createdAtMs: expect.any(Number),
    });
    expect(repository.updateTask).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      task_id: runningTask.task_id,
      lease_owner: "delete-owner",
      nowMs: expect.any(Number),
      allowExpiredLeaseRelease: true,
      patch: {
        status: "cancelled",
        approval_id: null,
        finished_at: expect.any(String),
        result_summary: "Deleted by operator.",
      },
      updatedAtIso: expect.any(String),
    });
    expect(effects.resolvePendingInterventionApprovals).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      work_item_id: item.work_item_id,
      decision: "denied",
      reason: "Work deleted by operator.",
    });
    expect(repository.updateSignal).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      signal_id: "signal-1",
      patch: { status: "cancelled" },
    });
    expect(repository.deleteItem).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      work_item_id: item.work_item_id,
    });
    expect(effects.emitDeleteEffects).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      childItemIds: ["work-child-1"],
      attachedSignalIds: ["signal-1"],
    });
    expect(effects.emitItemEvent).toHaveBeenCalledWith({
      type: "work.item.deleted",
      item,
    });
  });
});
