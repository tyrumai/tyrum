import { describe, expect, it, vi } from "vitest";
import type { Approval } from "@tyrum/schemas";
import type {
  PairingListResponse,
  PresenceResponse,
  StatusResponse,
  UsageResponse,
} from "@tyrum/client";
import { createElevatedModeStore } from "../src/index.js";
import {
  FakeWsClient,
  createFakeHttpClient,
  createTestOperatorCore,
  deferred,
  sampleApprovalApproved,
  sampleApprovalPending,
  sampleAttempt,
  samplePairingPending,
  samplePresenceEntry,
  samplePresenceResponse,
  sampleRun,
  sampleStatusResponse,
  sampleStep,
  sampleUsageResponse,
  tick,
} from "./operator-core.test-support.js";

describe("operator-core wiring", () => {
  it("exposes full HTTP client APIs even when deps.http is partial", () => {
    const { core } = createTestOperatorCore();

    expect(typeof (core.http as Record<string, unknown>)["models"]).toBe("object");
    expect(typeof (core.http as Record<string, unknown>)["authProfiles"]).toBe("object");
    expect(typeof (core.http as Record<string, unknown>)["authPins"]).toBe("object");
    expect(typeof (core.http as Record<string, unknown>)["secrets"]).toBe("object");
    expect(typeof (core.http as Record<string, unknown>)["policy"]).toBe("object");
    expect(typeof (core.http as Record<string, unknown>)["deviceTokens"]).toBe("object");
  });

  it("exposes wsUrl + httpBaseUrl on the core", () => {
    const { core } = createTestOperatorCore();

    expect(core.wsUrl).toBe("ws://127.0.0.1:8788/ws");
    expect(core.httpBaseUrl).toBe("http://127.0.0.1:8788");
  });

  it("exposes memoryStore on the core", () => {
    const { core } = createTestOperatorCore();

    expect(
      (core as unknown as { memoryStore?: { getSnapshot: () => unknown } }).memoryStore,
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
    const runsListBefore = ws.runList.mock.calls.length;

    await core.syncAllNow();
    await tick();

    expect(http.__calls.statusGet).toBe(statusGetBefore + 1);
    expect(http.__calls.usageGet).toBe(usageGetBefore + 1);
    expect(http.__calls.presenceList).toBe(presenceListBefore + 1);
    expect(http.__calls.pairingsList).toBe(pairingsListBefore + 1);
    expect(ws.approvalList).toHaveBeenCalledTimes(approvalsListBefore + 1);
    expect(ws.runList).toHaveBeenCalledTimes(runsListBefore + 1);
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
    expect(ws.approvalList).toHaveBeenCalledTimes(1);
    expect(ws.runList).toHaveBeenCalledTimes(1);

    ws.emit("approval.requested", {
      payload: { approval: sampleApprovalPending() },
    });
    expect(core.approvalsStore.getSnapshot().pendingIds).toEqual([1]);

    ws.emit("approval.resolved", {
      payload: { approval: sampleApprovalApproved() },
    });
    expect(core.approvalsStore.getSnapshot().pendingIds).toEqual([]);

    ws.emit("pairing.requested", { payload: { pairing: samplePairingPending() } });
    expect(core.pairingStore.getSnapshot().pendingIds).toEqual([10]);

    ws.emit("presence.upserted", { payload: { entry: samplePresenceEntry() } });
    expect(core.statusStore.getSnapshot().presenceByInstanceId["client-1"]).toMatchObject({
      instance_id: "client-1",
    });

    ws.emit("run.updated", { payload: { run: sampleRun() } });
    ws.emit("step.updated", { payload: { step: sampleStep() } });
    ws.emit("attempt.updated", { payload: { attempt: sampleAttempt() } });

    const runs = core.runsStore.getSnapshot();
    expect(Object.keys(runs.runsById)).toEqual(["run-1"]);
    expect(runs.stepIdsByRunId["run-1"]).toEqual(["step-1"]);
    expect(runs.attemptIdsByStepId["step-1"]).toEqual(["attempt-1"]);
  });

  it("hydrates approvalsStore from approval_request envelopes", () => {
    const { core, ws } = createTestOperatorCore();

    ws.emit("approval_request", {
      occurred_at: "2026-01-01T00:00:05.000Z",
      payload: {
        approval_id: "11111111-1111-1111-1111-111111111111",
        approval_key: "approval:11111111-1111-1111-1111-111111111111",
        kind: "other",
        prompt: "Approve shell.exec?",
        context: {
          session_id: "session-1",
          thread_id: "ui-1",
          tool_call_id: "tool-1",
        },
      },
    });

    expect(core.approvalsStore.getSnapshot().pendingIds).toEqual([
      "11111111-1111-1111-1111-111111111111",
    ]);
    expect(core.approvalsStore.getSnapshot().byId["11111111-1111-1111-1111-111111111111"]).toEqual(
      expect.objectContaining({
        approval_id: "11111111-1111-1111-1111-111111111111",
        status: "pending",
        prompt: "Approve shell.exec?",
        created_at: "2026-01-01T00:00:05.000Z",
        resolution: null,
      }),
    );
  });

  it("hydrates recent runs from run.list on connect", async () => {
    const { core, ws } = createTestOperatorCore();
    const run = {
      ...sampleRun(),
      run_id: "11111111-1111-1111-1111-111111111111",
      job_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      key: "cron:watcher-1",
      lane: "heartbeat",
    };
    const step = {
      ...sampleStep(),
      step_id: "22222222-2222-2222-2222-222222222222",
      run_id: run.run_id,
    };
    const attempt = {
      ...sampleAttempt(),
      attempt_id: "33333333-3333-3333-3333-333333333333",
      step_id: step.step_id,
    };
    ws.runList.mockResolvedValueOnce({
      runs: [{ run, agent_key: "default" }],
      steps: [step],
      attempts: [attempt],
    });

    ws.emit("connected", { clientId: "client-123" });
    await tick();

    const runs = core.runsStore.getSnapshot();
    expect(runs.runsById[run.run_id]).toMatchObject({ lane: "heartbeat", key: "cron:watcher-1" });
    expect(runs.stepIdsByRunId[run.run_id]).toEqual([step.step_id]);
    expect(runs.attemptIdsByStepId[step.step_id]).toEqual([attempt.attempt_id]);
    expect(runs.agentKeyByRunId?.[run.run_id]).toBe("default");
  });

  it("updates activityStore from message activity WS events", () => {
    const { core, ws } = createTestOperatorCore();

    ws.emit("typing.started", {
      payload: {
        session_id: "agent:alpha:main",
        lane: "main",
      },
      occurred_at: "2026-01-01T00:00:01.000Z",
    });
    ws.emit("message.delta", {
      payload: {
        session_id: "agent:alpha:main",
        lane: "main",
        message_id: "message-1",
        role: "assistant",
        delta: "Drafting plan",
      },
      occurred_at: "2026-01-01T00:00:02.000Z",
    });

    const workstream = core.activityStore.getSnapshot().workstreamsById["agent:alpha:main::main"];
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
    expect(ws.approvalList).toHaveBeenCalledTimes(1);
    expect(ws.runList).toHaveBeenCalledTimes(1);
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

  it("refreshStatus ignores stale responses and does not clear loading early", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const statusA: StatusResponse = { ...sampleStatusResponse(), version: "0.1.0-a" };
    const statusB: StatusResponse = { ...sampleStatusResponse(), version: "0.1.0-b" };

    const statusGetA = deferred<StatusResponse>();
    const statusGetB = deferred<StatusResponse>();
    let call = 0;
    http.status.get = vi.fn(async () => {
      call++;
      return call === 1 ? statusGetA.promise : statusGetB.promise;
    });

    const { core } = createTestOperatorCore({ ws, http });

    const p1 = core.statusStore.refreshStatus();
    const p2 = core.statusStore.refreshStatus();

    statusGetA.resolve(statusA);
    await p1;

    expect(core.statusStore.getSnapshot().loading.status).toBe(true);
    expect(core.statusStore.getSnapshot().status).toBe(null);

    statusGetB.resolve(statusB);
    await p2;

    expect(core.statusStore.getSnapshot().loading.status).toBe(false);
    expect(core.statusStore.getSnapshot().status).toMatchObject({ version: "0.1.0-b" });
  });

  it("refreshUsage ignores stale responses and does not clear loading early", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const usageA: UsageResponse = {
      ...sampleUsageResponse(),
      generated_at: "2026-01-01T00:00:00.000Z",
    };
    const usageB: UsageResponse = {
      ...sampleUsageResponse(),
      generated_at: "2026-01-02T00:00:00.000Z",
    };

    const usageGetA = deferred<UsageResponse>();
    const usageGetB = deferred<UsageResponse>();
    let call = 0;
    http.usage.get = vi.fn(async () => {
      call++;
      return call === 1 ? usageGetA.promise : usageGetB.promise;
    });

    const { core } = createTestOperatorCore({ ws, http });

    const p1 = core.statusStore.refreshUsage();
    const p2 = core.statusStore.refreshUsage();

    usageGetA.resolve(usageA);
    await p1;

    expect(core.statusStore.getSnapshot().loading.usage).toBe(true);
    expect(core.statusStore.getSnapshot().usage).toBe(null);

    usageGetB.resolve(usageB);
    await p2;

    expect(core.statusStore.getSnapshot().loading.usage).toBe(false);
    expect(core.statusStore.getSnapshot().usage).toMatchObject({
      generated_at: "2026-01-02T00:00:00.000Z",
    });
  });

  it("does not drop WS approvals during refreshPending", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const approvalList = deferred<{ approvals: Approval[]; next_cursor?: string }>();
    ws.approvalList = vi.fn(async () => approvalList.promise);

    const { core } = createTestOperatorCore({ ws, http });

    ws.emit("connected", { clientId: "client-123" });
    ws.emit("approval.requested", { payload: { approval: sampleApprovalPending() } });
    expect(core.approvalsStore.getSnapshot().pendingIds).toEqual([1]);

    approvalList.resolve({ approvals: [], next_cursor: undefined });
    await tick();

    expect(core.approvalsStore.getSnapshot().pendingIds).toEqual([1]);
  });

  it("does not drop WS pairings during refresh", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const pairingsList = deferred<PairingListResponse>();
    http.pairings.list = vi.fn(async () => pairingsList.promise);

    const { core } = createTestOperatorCore({ ws, http });

    ws.emit("connected", { clientId: "client-123" });
    ws.emit("pairing.requested", { payload: { pairing: samplePairingPending() } });
    expect(core.pairingStore.getSnapshot().pendingIds).toEqual([10]);

    pairingsList.resolve({ status: "ok", pairings: [] });
    await tick();

    expect(core.pairingStore.getSnapshot().pendingIds).toEqual([10]);
  });

  it("does not drop WS presence updates during refreshPresence", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const presenceList = deferred<PresenceResponse>();
    http.presence.list = vi.fn(async () => presenceList.promise);

    const { core } = createTestOperatorCore({ ws, http });

    const entryA = samplePresenceEntry();
    const entryB = { ...entryA, instance_id: "client-2" };

    ws.emit("connected", { clientId: "client-123" });
    ws.emit("presence.upserted", { payload: { entry: entryA } });
    ws.emit("presence.upserted", { payload: { entry: entryB } });
    ws.emit("presence.pruned", { payload: { instance_id: "client-2" } });

    presenceList.resolve({ ...samplePresenceResponse(), entries: [entryB] });
    await tick();

    const presenceByInstanceId = core.statusStore.getSnapshot().presenceByInstanceId;
    expect(presenceByInstanceId["client-1"]).toMatchObject({ instance_id: "client-1" });
    expect(presenceByInstanceId["client-2"]).toBeUndefined();
  });

  it("preserves lastDisconnect when disconnect triggers a synchronous close event", async () => {
    const ws = new FakeWsClient();

    ws.disconnect = vi.fn(() => {
      ws.emit("disconnected", { code: 1000, reason: "client disconnect" });
    });

    const { core } = createTestOperatorCore({ ws });

    ws.emit("connected", { clientId: "client-123" });
    await tick();

    core.disconnect();
    expect(core.connectionStore.getSnapshot().lastDisconnect).toEqual({
      code: 1000,
      reason: "client disconnect",
    });
  });

  it("dispose disconnects the websocket", () => {
    const { core, ws } = createTestOperatorCore();

    core.connect();
    core.dispose();

    expect(ws.disconnect).toHaveBeenCalledTimes(1);
  });

  it("does not dispose an injected elevatedModeStore", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-27T00:00:00.000Z"));

    try {
      const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });

      elevatedModeStore.enter({
        elevatedToken: "elevated-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });

      const { core } = createTestOperatorCore({
        authToken: "baseline-token",
        elevatedModeStore,
      });

      expect(core.elevatedModeStore).toBe(elevatedModeStore);

      core.dispose();

      expect(elevatedModeStore.getSnapshot().status).toBe("active");
      elevatedModeStore.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-syncs on reconnect", async () => {
    const { http, ws } = createTestOperatorCore();

    ws.emit("connected", { clientId: "client-123" });
    await tick();
    expect(http.__calls.statusGet).toBe(1);
    expect(ws.approvalList).toHaveBeenCalledTimes(1);
    expect(ws.runList).toHaveBeenCalledTimes(1);

    ws.emit("disconnected", { code: 1006, reason: "net down" });
    ws.emit("connected", { clientId: "client-123" });
    await tick();

    expect(http.__calls.statusGet).toBe(2);
    expect(ws.approvalList).toHaveBeenCalledTimes(2);
    expect(ws.runList).toHaveBeenCalledTimes(2);
  });
});
