import { describe, expect, it, vi } from "vitest";
import type {
  Approval,
  ExecutionAttempt,
  ExecutionRun,
  ExecutionStep,
  NodePairingRequest,
  PresenceEntry,
} from "@tyrum/schemas";
import type {
  PairingListResponse,
  PresenceResponse,
  StatusResponse,
  TyrumHttpClient,
  UsageResponse,
} from "@tyrum/client";
import { createBearerTokenAuth, createOperatorCore } from "../src/index.js";

type Handler = (data: unknown) => void;

class FakeWsClient {
  connected = false;
  private readonly handlers = new Map<string, Set<Handler>>();

  connect = vi.fn(() => {});
  disconnect = vi.fn(() => {});
  approvalList = vi.fn(async () => ({ approvals: [], next_cursor: undefined }));
  approvalResolve = vi.fn(async () => ({ approval: sampleApprovalApproved() }));

  on(event: string, handler: Handler): void {
    const existing = this.handlers.get(event);
    if (existing) {
      existing.add(handler);
      return;
    }
    this.handlers.set(event, new Set([handler]));
  }

  off(event: string, handler: Handler): void {
    const existing = this.handlers.get(event);
    if (!existing) return;
    existing.delete(handler);
    if (existing.size === 0) {
      this.handlers.delete(event);
    }
  }

  emit(event: string, data: unknown): void {
    if (event === "connected") {
      this.connected = true;
    }
    if (event === "disconnected") {
      this.connected = false;
    }
    for (const handler of this.handlers.get(event) ?? []) {
      handler(data);
    }
  }
}

function sampleStatusResponse(): StatusResponse {
  return {
    status: "ok",
    version: "0.1.0",
    instance_id: "gateway-1",
    role: "gateway",
    db_kind: "sqlite",
    is_exposed: false,
    otel_enabled: false,
    ws: null,
    policy: null,
    model_auth: null,
    catalog_freshness: null,
    session_lanes: null,
    queue_depth: null,
    sandbox: null,
  };
}

function sampleUsageResponse(): UsageResponse {
  return {
    status: "ok",
    generated_at: "2026-01-01T00:00:00.000Z",
    scope: { kind: "deployment", run_id: null, key: null, agent_id: null },
    local: {
      attempts: { total_with_cost: 0, parsed: 0, invalid: 0 },
      totals: { duration_ms: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, usd_micros: 0 },
    },
    provider: null,
  };
}

function samplePresenceResponse(): PresenceResponse {
  return {
    status: "ok",
    generated_at: "2026-01-01T00:00:00.000Z",
    entries: [],
  };
}

function samplePairingListResponse(): PairingListResponse {
  return { status: "ok", pairings: [] };
}

function createFakeHttpClient(): Pick<
  TyrumHttpClient,
  "status" | "usage" | "presence" | "pairings"
> & {
  __calls: {
    statusGet: number;
    usageGet: number;
    presenceList: number;
    pairingsList: number;
  };
} {
  const calls = {
    statusGet: 0,
    usageGet: 0,
    presenceList: 0,
    pairingsList: 0,
  };

  return {
    __calls: calls,
    status: {
      get: vi.fn(async () => {
        calls.statusGet++;
        return sampleStatusResponse();
      }),
    },
    usage: {
      get: vi.fn(async () => {
        calls.usageGet++;
        return sampleUsageResponse();
      }),
    },
    presence: {
      list: vi.fn(async () => {
        calls.presenceList++;
        return samplePresenceResponse();
      }),
    },
    pairings: {
      list: vi.fn(async () => {
        calls.pairingsList++;
        return samplePairingListResponse();
      }),
      approve: vi.fn(async () => ({ status: "ok", pairing: samplePairingApproved() })),
      deny: vi.fn(async () => ({ status: "ok", pairing: samplePairingDenied() })),
      revoke: vi.fn(async () => ({ status: "ok", pairing: samplePairingRevoked() })),
    },
  };
}

function sampleApprovalPending(): Approval {
  return {
    approval_id: 1,
    kind: "other",
    status: "pending",
    prompt: "Approve?",
    created_at: "2026-01-01T00:00:00.000Z",
    resolution: null,
  };
}

function sampleApprovalApproved(): Approval {
  return {
    approval_id: 1,
    kind: "other",
    status: "approved",
    prompt: "Approve?",
    created_at: "2026-01-01T00:00:00.000Z",
    resolution: {
      decision: "approved",
      resolved_at: "2026-01-01T00:00:01.000Z",
    },
  };
}

function samplePairingPending(): NodePairingRequest {
  return {
    pairing_id: 10,
    status: "pending",
    requested_at: "2026-01-01T00:00:00.000Z",
    node: {
      node_id: "node-1",
      label: "test-node",
      capabilities: [],
      last_seen_at: "2026-01-01T00:00:00.000Z",
    },
    capability_allowlist: [],
    resolution: null,
    resolved_at: null,
  };
}

function samplePairingApproved(): NodePairingRequest {
  return {
    ...samplePairingPending(),
    status: "approved",
    trust_level: "local",
    resolution: {
      decision: "approved",
      resolved_at: "2026-01-01T00:00:01.000Z",
    },
    resolved_at: "2026-01-01T00:00:01.000Z",
  };
}

function samplePairingDenied(): NodePairingRequest {
  return {
    ...samplePairingPending(),
    status: "denied",
    resolution: {
      decision: "denied",
      resolved_at: "2026-01-01T00:00:01.000Z",
    },
    resolved_at: "2026-01-01T00:00:01.000Z",
  };
}

function samplePairingRevoked(): NodePairingRequest {
  return {
    ...samplePairingPending(),
    status: "revoked",
    resolution: {
      decision: "revoked",
      resolved_at: "2026-01-01T00:00:01.000Z",
    },
    resolved_at: "2026-01-01T00:00:01.000Z",
  };
}

function samplePresenceEntry(): PresenceEntry {
  return {
    instance_id: "client-1",
    role: "client",
    last_seen_at: "2026-01-01T00:00:00.000Z",
  };
}

function sampleRun(): ExecutionRun {
  return {
    run_id: "run-1",
    job_id: "job-1",
    key: "t:test",
    lane: "default",
    status: "running",
    attempt: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    started_at: "2026-01-01T00:00:01.000Z",
    finished_at: null,
  };
}

function sampleStep(): ExecutionStep {
  return {
    step_id: "step-1",
    run_id: "run-1",
    step_index: 0,
    status: "running",
    action: { type: "Research", args: {} },
    created_at: "2026-01-01T00:00:02.000Z",
  };
}

function sampleAttempt(): ExecutionAttempt {
  return {
    attempt_id: "attempt-1",
    step_id: "step-1",
    attempt: 1,
    status: "running",
    started_at: "2026-01-01T00:00:03.000Z",
    finished_at: null,
    error: null,
    artifacts: [],
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("operator-core wiring", () => {
  it("updates stores from WS events", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

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

  it("treats connected without clientId as connected", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

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
  });

  it("clears clientId when reconnecting", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

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

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

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

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

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

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

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

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

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

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

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
    const http = createFakeHttpClient();

    ws.disconnect = vi.fn(() => {
      ws.emit("disconnected", { code: 1000, reason: "client disconnect" });
    });

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    ws.emit("connected", { clientId: "client-123" });
    await tick();

    core.disconnect();
    expect(core.connectionStore.getSnapshot().lastDisconnect).toEqual({
      code: 1000,
      reason: "client disconnect",
    });
  });

  it("dispose disconnects the websocket", () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    core.connect();
    core.dispose();

    expect(ws.disconnect).toHaveBeenCalledTimes(1);
  });

  it("re-syncs on reconnect", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const _core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    ws.emit("connected", { clientId: "client-123" });
    await tick();
    expect(http.__calls.statusGet).toBe(1);
    expect(ws.approvalList).toHaveBeenCalledTimes(1);

    ws.emit("disconnected", { code: 1006, reason: "net down" });
    ws.emit("connected", { clientId: "client-123" });
    await tick();

    expect(http.__calls.statusGet).toBe(2);
    expect(ws.approvalList).toHaveBeenCalledTimes(2);
  });
});
