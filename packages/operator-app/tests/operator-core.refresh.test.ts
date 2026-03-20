import { describe, expect, it, vi } from "vitest";
import type { Approval } from "@tyrum/contracts";
import type {
  PairingListResponse,
  PresenceResponse,
  StatusResponse,
  UsageResponse,
} from "@tyrum/transport-sdk";
import { createElevatedModeStore } from "../src/index.js";
import {
  FakeWsClient,
  createFakeHttpClient,
  createTestOperatorCore,
  deferred,
  sampleApprovalPending,
  samplePairingPending,
  samplePresenceEntry,
  samplePresenceResponse,
  sampleStatusResponse,
  sampleUsageResponse,
  tick,
} from "./operator-core.test-support.js";

describe("operator-core refresh + lifecycle wiring", () => {
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
    ws.emit("approval.updated", { payload: { approval: sampleApprovalPending() } });
    expect(core.approvalsStore.getSnapshot().pendingIds).toEqual([
      "11111111-1111-1111-1111-111111111111",
    ]);

    approvalList.resolve({ approvals: [], next_cursor: undefined });
    await tick();

    expect(core.approvalsStore.getSnapshot().pendingIds).toEqual([
      "11111111-1111-1111-1111-111111111111",
    ]);
  });

  it("does not drop WS pairings during refresh", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const pairingsList = deferred<PairingListResponse>();
    http.pairings.list = vi.fn(async () => pairingsList.promise);

    const { core } = createTestOperatorCore({ ws, http });

    ws.emit("connected", { clientId: "client-123" });
    ws.emit("pairing.updated", { payload: { pairing: samplePairingPending() } });
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
    expect(ws.approvalList).toHaveBeenCalledTimes(5);
    expect(ws.runList).toHaveBeenCalledTimes(1);

    ws.emit("disconnected", { code: 1006, reason: "net down" });
    ws.emit("connected", { clientId: "client-123" });
    await tick();

    expect(http.__calls.statusGet).toBe(2);
    expect(ws.approvalList).toHaveBeenCalledTimes(10);
    expect(ws.runList).toHaveBeenCalledTimes(2);
  });
});
