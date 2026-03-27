import { describe, expect, it, vi } from "vitest";
import { buildAgentConversationKey } from "@tyrum/contracts";
import {
  createTestOperatorCore,
  sampleApprovalApproved,
  sampleApprovalPending,
  sampleAttempt,
  samplePairingPending,
  samplePresenceEntry,
  sampleRun,
  sampleStep,
  tick,
} from "./operator-core.test-support.js";

describe("operator-core wiring", () => {
  it("exposes full HTTP client APIs even when deps.http is partial", () => {
    const { core } = createTestOperatorCore();

    expect(typeof (core.admin as Record<string, unknown>)["models"]).toBe("object");
    expect(typeof (core.admin as Record<string, unknown>)["authProfiles"]).toBe("object");
    expect(typeof (core.admin as Record<string, unknown>)["authPins"]).toBe("object");
    expect(typeof (core.admin as Record<string, unknown>)["secrets"]).toBe("object");
    expect(typeof (core.admin as Record<string, unknown>)["policy"]).toBe("object");
    expect(typeof (core.admin as Record<string, unknown>)["deviceTokens"]).toBe("object");
  });

  it("exposes wsUrl + httpBaseUrl on the core", () => {
    const { core } = createTestOperatorCore();

    expect(core.wsUrl).toBe("ws://127.0.0.1:8788/ws");
    expect(core.httpBaseUrl).toBe("http://127.0.0.1:8788");
  });

  it("exposes desktop environment stores on the core", () => {
    const { core } = createTestOperatorCore();

    expect(
      (core as unknown as { desktopEnvironmentHostsStore?: { getSnapshot: () => unknown } })
        .desktopEnvironmentHostsStore,
    ).toBeDefined();
    expect(
      (core as unknown as { desktopEnvironmentsStore?: { getSnapshot: () => unknown } })
        .desktopEnvironmentsStore,
    ).toBeDefined();
  });

  it("exposes chatStore on the core", () => {
    const { core } = createTestOperatorCore();

    expect(
      (core as unknown as { chatStore?: { getSnapshot: () => unknown } }).chatStore,
    ).toBeDefined();
  });

  it("exposes activityStore on the core", () => {
    const { core } = createTestOperatorCore();

    expect(
      (core as unknown as { activityStore?: { getSnapshot: () => unknown } }).activityStore,
    ).toBeDefined();
  });

  it("exposes autoSyncStore and syncAllNow triggers tasks", async () => {
    const { core, http, ws } = createTestOperatorCore();

    expect(
      (core as unknown as { autoSyncStore?: { getSnapshot: () => unknown } }).autoSyncStore,
    ).toBeDefined();
    expect(typeof (core as unknown as { syncAllNow?: unknown }).syncAllNow).toBe("function");

    ws.emit("connected", { clientId: "client-123" });
    await tick();

    const statusGetBefore = http.__calls.statusGet;
    const usageGetBefore = http.__calls.usageGet;
    const presenceListBefore = http.__calls.presenceList;
    const pairingsListBefore = http.__calls.pairingsList;
    const approvalsListBefore = ws.approvalList.mock.calls.length;
    const runsListBefore = ws.turnList.mock.calls.length;
    const desktopEnvironmentHostsListBefore = http.__calls.desktopEnvironmentHostsList;
    const desktopEnvironmentsListBefore = http.__calls.desktopEnvironmentsList;
    const agentListGetBefore = http.__calls.agentListGet;

    await core.syncAllNow();
    await tick();

    expect(http.__calls.statusGet).toBe(statusGetBefore + 1);
    expect(http.__calls.usageGet).toBe(usageGetBefore + 1);
    expect(http.__calls.presenceList).toBe(presenceListBefore + 1);
    expect(http.__calls.pairingsList).toBe(pairingsListBefore + 1);
    expect(http.__calls.desktopEnvironmentHostsList).toBe(desktopEnvironmentHostsListBefore + 1);
    expect(http.__calls.desktopEnvironmentsList).toBe(desktopEnvironmentsListBefore + 1);
    expect(http.__calls.agentListGet).toBe(agentListGetBefore + 1);
    expect(ws.approvalList).toHaveBeenCalledTimes(approvalsListBefore + 5);
    expect(ws.turnList).toHaveBeenCalledTimes(runsListBefore + 1);
  });

  it("exposes elevatedModeStore as a single source of truth", () => {
    const { core } = createTestOperatorCore();

    expect(core.elevatedModeStore.getSnapshot()).toMatchObject({
      status: "inactive",
      elevatedToken: null,
      expiresAt: null,
    });
  });

  it("updates stores from WS events", async () => {
    const { core, http, ws } = createTestOperatorCore();

    core.connect();
    expect(core.connectionStore.getSnapshot().status).toBe("connecting");
    expect(ws.connect).toHaveBeenCalledTimes(1);

    ws.emit("connected", { clientId: "client-123" });
    await tick();

    expect(core.connectionStore.getSnapshot()).toMatchObject({
      status: "connected",
      clientId: "client-123",
    });
    expect(http.__calls.statusGet).toBe(1);
    expect(http.__calls.presenceList).toBe(1);
    expect(http.__calls.pairingsList).toBe(1);
    expect(http.__calls.desktopEnvironmentHostsList).toBe(1);
    expect(http.__calls.desktopEnvironmentsList).toBe(1);
    expect(ws.approvalList).toHaveBeenCalledTimes(5);
    expect(ws.turnList).toHaveBeenCalledTimes(1);

    ws.emit("approval.updated", {
      payload: { approval: sampleApprovalPending() },
    });
    expect(core.approvalsStore.getSnapshot().pendingIds).toEqual([
      "11111111-1111-1111-1111-111111111111",
    ]);

    ws.emit("approval.updated", {
      payload: { approval: sampleApprovalApproved() },
    });
    expect(core.approvalsStore.getSnapshot().pendingIds).toEqual([]);

    ws.emit("pairing.updated", { payload: { pairing: samplePairingPending() } });
    expect(core.pairingStore.getSnapshot().pendingIds).toEqual([10]);

    ws.emit("presence.upserted", { payload: { entry: samplePresenceEntry() } });
    expect(core.statusStore.getSnapshot().presenceByInstanceId["client-1"]).toMatchObject({
      instance_id: "client-1",
    });

    ws.emit("turn.updated", {
      payload: {
        turn: {
          turn_id: "run-1",
          job_id: "job-1",
          conversation_key: "agent:default:main",
          status: "running",
          attempt: 1,
          created_at: "2026-01-01T00:00:00.000Z",
          started_at: "2026-01-01T00:00:01.000Z",
          finished_at: null,
        },
      },
    });
    ws.emit("step.updated", {
      payload: {
        step: {
          step_id: "step-1",
          turn_id: "run-1",
          step_index: 0,
          status: "running",
          action: { type: "Research", args: {} },
          created_at: "2026-01-01T00:00:02.000Z",
        },
      },
    });
    ws.emit("attempt.updated", { payload: { attempt: sampleAttempt() } });

    const runs = core.runsStore.getSnapshot();
    expect(Object.keys(runs.runsById)).toEqual(["run-1"]);
    expect(runs.stepIdsByRunId["run-1"]).toEqual(["step-1"]);
    expect(runs.attemptIdsByStepId["step-1"]).toEqual(["attempt-1"]);
  });

  it("hydrates approvalsStore from approval.updated envelopes", () => {
    const { core, ws } = createTestOperatorCore();

    ws.emit("approval.updated", {
      occurred_at: "2026-01-01T00:00:05.000Z",
      payload: {
        approval: {
          approval_id: "11111111-1111-1111-1111-111111111111",
          approval_key: "approval:11111111-1111-1111-1111-111111111111",
          kind: "policy",
          status: "awaiting_human",
          prompt: "Approve shell.exec?",
          motivation: "Approve shell.exec?",
          created_at: "2026-01-01T00:00:05.000Z",
          expires_at: null,
          latest_review: {
            review_id: "review-1",
            target_type: "approval",
            target_id: "11111111-1111-1111-1111-111111111111",
            reviewer_kind: "guardian",
            reviewer_id: "guardian-1",
            state: "requested_human",
            reason: "Guardian requested human review.",
            risk_level: "medium",
            risk_score: 0.5,
            evidence: null,
            decision_payload: null,
            created_at: "2026-01-01T00:00:05.000Z",
            started_at: "2026-01-01T00:00:05.000Z",
            completed_at: "2026-01-01T00:00:05.000Z",
          },
          context: {
            session_id: "session-1",
            thread_id: "ui-1",
            tool_call_id: "tool-1",
          },
        },
      },
    });

    expect(core.approvalsStore.getSnapshot().pendingIds).toEqual([
      "11111111-1111-1111-1111-111111111111",
    ]);
    expect(core.approvalsStore.getSnapshot().byId["11111111-1111-1111-1111-111111111111"]).toEqual(
      expect.objectContaining({
        approval_id: "11111111-1111-1111-1111-111111111111",
        status: "awaiting_human",
        prompt: "Approve shell.exec?",
        motivation: "Approve shell.exec?",
        created_at: "2026-01-01T00:00:05.000Z",
        latest_review: expect.objectContaining({
          state: "requested_human",
          reason: "Guardian requested human review.",
        }),
      }),
    );
  });

  it("hydrates recent runs from run.list on connect", async () => {
    const { core, ws } = createTestOperatorCore();
    const automationConversationKey = buildAgentConversationKey({
      agentKey: "default",
      container: "channel",
      channel: "automation",
      account: "default",
      id: "schedule-watcher-1",
    });
    const run = {
      ...sampleRun(),
      turn_id: "11111111-1111-1111-1111-111111111111",
      job_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      conversation_key: automationConversationKey,
      status: "running",
    };
    const step = {
      ...sampleStep(),
      step_id: "22222222-2222-2222-2222-222222222222",
      turn_id: run.turn_id,
    };
    const attempt = {
      ...sampleAttempt(),
      attempt_id: "33333333-3333-3333-3333-333333333333",
      step_id: step.step_id,
    };
    ws.turnList.mockResolvedValueOnce({
      turns: [{ turn: run, agent_key: "default" }],
      steps: [step],
      attempts: [attempt],
    });

    ws.emit("connected", { clientId: "client-123" });
    await tick();

    const runs = core.runsStore.getSnapshot();
    expect(runs.runsById[run.turn_id]).toMatchObject({
      conversation_key: automationConversationKey,
    });
    expect(runs.stepIdsByRunId[run.turn_id]).toEqual([step.step_id]);
    expect(runs.attemptIdsByStepId[step.step_id]).toEqual([attempt.attempt_id]);
    expect(runs.agentKeyByRunId?.[run.turn_id]).toBe("default");
  });

  it("updates activityStore from message activity WS events", () => {
    const { core, ws } = createTestOperatorCore();

    ws.emit("typing.started", {
      payload: {
        conversation_id: "agent:alpha:main",
      },
      occurred_at: "2026-01-01T00:00:01.000Z",
    });
    ws.emit("message.delta", {
      payload: {
        conversation_id: "agent:alpha:main",
        message_id: "message-1",
        role: "assistant",
        delta: "Drafting plan",
      },
      occurred_at: "2026-01-01T00:00:02.000Z",
    });

    const workstream = core.activityStore.getSnapshot().workstreamsById["agent:alpha:main"];
    expect(workstream?.bubbleText).toBe("Drafting plan");
    expect(workstream?.currentRoom).toBe("mail-room");
    expect(workstream?.recentEvents.map((event) => event.type)).toEqual([
      "message.delta",
      "typing.started",
    ]);
  });

  it("uses payload.occurred_at for work.task events when envelope occurred_at is missing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:10.000Z"));

    try {
      const { core, ws } = createTestOperatorCore();

      ws.emit("work.task.started", {
        payload: {
          occurred_at: "2026-01-01T00:00:00.000Z",
          work_item_id: "work-1",
          task_id: "task-1",
          run_id: "run-1",
        },
      });

      const tasksByWorkItemId = core.workboardStore.getSnapshot().tasksByWorkItemId;
      expect(tasksByWorkItemId["work-1"]?.["task-1"]?.last_event_at).toBe(
        "2026-01-01T00:00:00.000Z",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes work items from the store when work.item.deleted arrives", () => {
    const { core, ws } = createTestOperatorCore();

    ws.emit("work.item.created", {
      payload: {
        item: {
          work_item_id: "work-1",
          title: "Delete me",
          status: "ready",
        },
      },
    });
    expect(core.workboardStore.getSnapshot().items.map((item) => item.work_item_id)).toEqual([
      "work-1",
    ]);

    ws.emit("work.item.deleted", {
      payload: {
        item: {
          work_item_id: "work-1",
        },
      },
    });

    expect(core.workboardStore.getSnapshot().items).toEqual([]);
  });

  it("ignores work item and task events from a different resolved workspace scope", async () => {
    const { core, ws } = createTestOperatorCore();

    core.workboardStore.setScopeKeys({ agent_key: "planner", workspace_key: "ops" });
    ws.workList.mockResolvedValueOnce({
      scope: {
        tenant_id: "tenant-1",
        agent_id: "agent-in-scope",
        workspace_id: "workspace-in-scope",
      },
      items: [],
    });

    await core.workboardStore.refreshList();

    ws.emit("work.item.created", {
      payload: {
        item: {
          work_item_id: "work-out",
          tenant_id: "tenant-1",
          agent_id: "agent-in-scope",
          workspace_id: "workspace-out-of-scope",
          title: "Ignore me",
          kind: "action",
          status: "ready",
          priority: 0,
          created_at: "2026-01-01T00:00:00.000Z",
          created_from_session_key: "agent:planner:main",
          last_active_at: null,
        },
      },
    });
    ws.emit("work.task.started", {
      payload: {
        tenant_id: "tenant-1",
        agent_id: "agent-in-scope",
        workspace_id: "workspace-out-of-scope",
        work_item_id: "work-out",
        task_id: "task-out",
        run_id: "run-out",
      },
    });

    expect(core.workboardStore.getSnapshot().items).toEqual([]);
    expect(core.workboardStore.getSnapshot().tasksByWorkItemId["work-out"]).toBeUndefined();
  });

  it("ignores workboard events before the workboard scope is resolved", () => {
    const { core, ws } = createTestOperatorCore();

    core.workboardStore.setScopeKeys({ agent_key: "planner", workspace_key: "ops" });

    ws.emit("work.item.created", {
      payload: {
        item: {
          work_item_id: "work-pending",
          tenant_id: "tenant-1",
          agent_id: "agent-in-scope",
          workspace_id: "workspace-in-scope",
          title: "Ignore me",
          kind: "action",
          status: "ready",
          priority: 0,
          created_at: "2026-01-01T00:00:00.000Z",
          created_from_session_key: "agent:planner:main",
          last_active_at: null,
        },
      },
    });
    ws.emit("work.task.started", {
      payload: {
        tenant_id: "tenant-1",
        agent_id: "agent-in-scope",
        workspace_id: "workspace-in-scope",
        work_item_id: "work-pending",
        task_id: "task-pending",
        run_id: "run-pending",
      },
    });

    expect(core.workboardStore.getSnapshot().items).toEqual([]);
    expect(core.workboardStore.getSnapshot().tasksByWorkItemId["work-pending"]).toBeUndefined();
  });

  it("records transport_error messages from the WS client", async () => {
    const { core, ws } = createTestOperatorCore();

    core.connect();
    ws.emit("connected", { clientId: "client-123" });
    await tick();

    expect(core.connectionStore.getSnapshot().transportError).toBe(null);

    ws.emit("transport_error", { message: "oh no" });
    expect(core.connectionStore.getSnapshot().transportError).toBe("oh no");
  });

  it("treats connected without clientId as connected", async () => {
    const { core, http, ws } = createTestOperatorCore();

    core.connect();
    expect(core.connectionStore.getSnapshot().status).toBe("connecting");

    ws.emit("connected", { clientId: "" });
    await tick();

    expect(core.connectionStore.getSnapshot()).toMatchObject({
      status: "connected",
      clientId: null,
    });
    expect(http.__calls.statusGet).toBe(1);
    expect(http.__calls.usageGet).toBe(1);
    expect(http.__calls.presenceList).toBe(1);
    expect(http.__calls.pairingsList).toBe(1);
    expect(ws.approvalList).toHaveBeenCalledTimes(5);
    expect(ws.turnList).toHaveBeenCalledTimes(1);
  });

  it("clears clientId when reconnecting", async () => {
    const { core, ws } = createTestOperatorCore();

    core.connect();
    ws.emit("connected", { clientId: "client-123" });
    await tick();

    expect(core.connectionStore.getSnapshot()).toMatchObject({
      status: "connected",
      clientId: "client-123",
    });

    core.connect();

    expect(core.connectionStore.getSnapshot()).toMatchObject({
      status: "connecting",
      clientId: null,
    });
  });
});
