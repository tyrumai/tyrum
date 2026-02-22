/**
 * WebSocket protocol handler tests — verifies message parsing, dispatch
 * routing, task result handling, and human response handling.
 */

import { describe, expect, it, vi } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import {
  handleClientMessage,
  dispatchTask,
  requestApproval,
  sendPlanUpdate,
  NoCapableClientError,
} from "../../src/ws/protocol.js";
import type { ProtocolDeps } from "../../src/ws/protocol.js";

// ---------------------------------------------------------------------------
// Mock WebSocket helper
// ---------------------------------------------------------------------------

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  };
}

function makeDeps(
  cm: ConnectionManager,
  overrides?: Partial<ProtocolDeps>,
): ProtocolDeps {
  return { connectionManager: cm, ...overrides };
}

function makeClient(
  cm: ConnectionManager,
  capabilities: string[],
): { id: string; ws: MockWebSocket } {
  const ws = createMockWs();
  const id = `conn-${crypto.randomUUID()}`;
  const instanceId = `dev-${"a".repeat(8)}`;
  cm.addClient({
    connectionId: id,
    ws: ws as never,
    role: "client",
    instanceId,
    device: { device_id: instanceId, pubkey: "pubkey" },
    capabilities: capabilities as never,
  });
  return { id, ws };
}

function makeNode(cm: ConnectionManager, nodeId: string): { id: string; ws: MockWebSocket } {
  const ws = createMockWs();
  const id = `conn-${crypto.randomUUID()}`;
  cm.addClient({
    connectionId: id,
    ws: ws as never,
    role: "node",
    instanceId: nodeId,
    device: { device_id: nodeId, pubkey: "pubkey" },
    capabilities: [],
  });
  return { id, ws };
}

// ---------------------------------------------------------------------------
// handleClientMessage
// ---------------------------------------------------------------------------

describe("handleClientMessage", () => {
  it("returns error for invalid JSON", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = await handleClientMessage(client, "not json{{{", deps);
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string } }).payload;
    expect(payload.code).toBe("invalid_json");
  });

  it("returns error for invalid message schema", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = await handleClientMessage(
      client,
      JSON.stringify({ type: "unknown_type" }),
      deps,
    );
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string } }).payload;
    expect(payload.code).toBe("invalid_message");
  });

  it("returns error response for client-sent request envelopes", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = await handleClientMessage(
      client,
      JSON.stringify({ request_id: "r-1", type: "connect.init", payload: {} }),
      deps,
    );
    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    expect((result as unknown as { error: { code: string } }).error.code).toBe(
      "unsupported_request",
    );
  });

  it("handles session.send by calling the agent runtime", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;

    const turn = vi.fn().mockResolvedValue({
      reply: "hi",
      session_id: "internal:thread-1",
      used_tools: [],
      memory_written: false,
    });

    const deps = makeDeps(cm, {
      agentRuntime: { turn } as never,
    });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-session-1",
        type: "session.send",
        payload: { channel: "internal", thread_id: "thread-1", message: "hello" },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    expect(turn).toHaveBeenCalledTimes(1);
  });

  it("handles workflow.run by enqueuing an execution plan", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;

    const enqueuePlan = vi.fn().mockResolvedValue({
      jobId: "job-1",
      runId: "00000000-0000-4000-8000-000000000001",
    });

    const deps = makeDeps(cm, {
      executionEngine: {
        enqueuePlan,
        resumeRun: vi.fn(),
        cancelRunByResumeToken: vi.fn(),
        cancelRun: vi.fn(),
      } as never,
    });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-workflow-run-1",
        type: "workflow.run",
        payload: {
          key: "hook:00000000-0000-4000-8000-000000000002",
          lane: "main",
          pipeline: `id: demo\nname: Demo\nversion: 0.0.0\nsteps:\n  - id: one\n    command: cli echo hello\n`,
        },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    const ok = result as unknown as { result: { job_id: string; run_id: string; plan_id: string } };
    expect(ok.result.job_id).toBe("job-1");
    expect(ok.result.run_id).toBe("00000000-0000-4000-8000-000000000001");
    expect(ok.result.plan_id.startsWith("wf-")).toBe(true);
    expect(enqueuePlan).toHaveBeenCalledTimes(1);
  });

  it("dispatches task.execute response to callback", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "t-1",
        type: "task.execute",
        ok: true,
        result: { evidence: { screenshot: "base64..." } },
      }),
      deps,
    );

    expect(result).toBeUndefined();
    expect(onTaskResult).toHaveBeenCalledWith(
      "t-1",
      true,
      { screenshot: "base64..." },
      undefined,
    );
  });

  it("dispatches task.execute error response", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;
    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult });

    await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "t-2",
        type: "task.execute",
        ok: false,
        error: { code: "task_failed", message: "command failed" },
      }),
      deps,
    );

    expect(onTaskResult).toHaveBeenCalledWith(
      "t-2",
      false,
      undefined,
      "command failed",
    );
  });

  it("dispatches task.execute error response evidence from error details", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;
    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult });

    await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "t-3",
        type: "task.execute",
        ok: false,
        error: {
          code: "task_failed",
          message: "browser action failed",
          details: {
            evidence: { screenshot: "base64...", dom: "<html></html>" },
          },
        },
      }),
      deps,
    );

    expect(onTaskResult).toHaveBeenCalledWith(
      "t-3",
      false,
      { screenshot: "base64...", dom: "<html></html>" },
      "browser action failed",
    );
  });

  it("dispatches approval.request decision to callback", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "approval-123",
        type: "approval.request",
        ok: true,
        result: { approved: true },
      }),
      deps,
    );

    expect(result).toBeUndefined();
    expect(onApprovalDecision).toHaveBeenCalledWith(123, true, undefined);
  });

  it("dispatches approval.request rejection with reason", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });

    await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "approval-124",
        type: "approval.request",
        ok: true,
        result: { approved: false, reason: "too risky" },
      }),
      deps,
    );

    expect(onApprovalDecision).toHaveBeenCalledWith(124, false, "too risky");
  });

  it("does not auto-deny approval.request when client responds ok:false", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "approval-200",
        type: "approval.request",
        ok: false,
        error: { code: "invalid_request", message: "payload validation failed" },
      }),
      deps,
    );

    expect(onApprovalDecision).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string; message: string } })
      .payload;
    expect(payload.code).toBe("approval_request_failed");
    expect(payload.message).toContain("approval-200");
    expect(payload.message).toContain("payload validation failed");
  });

  it("returns error when approval.request ok payload is invalid", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "approval-125",
        type: "approval.request",
        ok: true,
        result: { approved: "yes" },
      }),
      deps,
    );

    expect(onApprovalDecision).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string } }).payload;
    expect(payload.code).toBe("invalid_approval_decision");
  });

  it("updates lastPong on ping response", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    // Set lastPong to something old.
    client.lastPong = 1000;

    const before = Date.now();
    const result = await handleClientMessage(
      client,
      JSON.stringify({ request_id: "ping-1", type: "ping", ok: true }),
      deps,
    );
    const after = Date.now();

    expect(result).toBeUndefined();
    expect(client.lastPong).toBeGreaterThanOrEqual(before);
    expect(client.lastPong).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// dispatchTask
// ---------------------------------------------------------------------------

describe("dispatchTask", () => {
  it("sends task.execute request to a capable client", async () => {
    const cm = new ConnectionManager();
    const { ws } = makeClient(cm, ["playwright"]);
    const deps = makeDeps(cm);

    const action: ActionPrimitive = {
      type: "Web",
      args: { url: "https://example.com" },
    };

    const taskId = await dispatchTask(
      action,
      {
        runId: "00000000-0000-4000-8000-000000000001",
        stepId: "00000000-0000-4000-8000-000000000002",
        attemptId: "00000000-0000-4000-8000-000000000003",
      },
      deps,
    );
    expect(taskId).toMatch(/^task-[0-9a-f-]{36}$/);

    expect(ws.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws.send.mock.calls[0]![0] as string) as Record<
      string,
      unknown
    >;
    expect(sent).toMatchObject({
      request_id: taskId,
      type: "task.execute",
      payload: {
        run_id: "00000000-0000-4000-8000-000000000001",
        step_id: "00000000-0000-4000-8000-000000000002",
        attempt_id: "00000000-0000-4000-8000-000000000003",
        action: { type: "Web", args: { url: "https://example.com" } },
      },
    });
  });

  it("throws NoCapableClientError when no client has the capability", () => {
    const cm = new ConnectionManager();
    makeClient(cm, ["cli"]); // Only CLI capability
    const deps = makeDeps(cm);

    const action: ActionPrimitive = {
      type: "Web",
      args: {},
    };

    expect(() => dispatchTask(action, {
      runId: "00000000-0000-4000-8000-000000000001",
      stepId: "00000000-0000-4000-8000-000000000002",
      attemptId: "00000000-0000-4000-8000-000000000003",
    }, deps)).toThrow(
      NoCapableClientError,
    );
  });

  it("throws NoCapableClientError when no clients are connected", () => {
    const cm = new ConnectionManager();
    const deps = makeDeps(cm);

    const action: ActionPrimitive = {
      type: "Http",
      args: {},
    };

    expect(() => dispatchTask(action, {
      runId: "00000000-0000-4000-8000-000000000001",
      stepId: "00000000-0000-4000-8000-000000000002",
      attemptId: "00000000-0000-4000-8000-000000000003",
    }, deps)).toThrow(
      NoCapableClientError,
    );
  });

  it("throws NoCapableClientError for unmapped action type", () => {
    const cm = new ConnectionManager();
    makeClient(cm, ["playwright"]);
    const deps = makeDeps(cm);

    // "Research" has no capability mapping
    const action: ActionPrimitive = {
      type: "Research",
      args: {},
    };

    expect(() => dispatchTask(action, {
      runId: "00000000-0000-4000-8000-000000000001",
      stepId: "00000000-0000-4000-8000-000000000002",
      attemptId: "00000000-0000-4000-8000-000000000003",
    }, deps)).toThrow(
      NoCapableClientError,
    );
  });
});

// ---------------------------------------------------------------------------
// requestApproval
// ---------------------------------------------------------------------------

describe("requestApproval", () => {
  it("sends approval.request to the first client", () => {
    const cm = new ConnectionManager();
    const { ws } = makeClient(cm, ["playwright"]);
    const deps = makeDeps(cm);

    requestApproval(
      {
        approval_id: 7,
        plan_id: "plan-1",
        step_index: 2,
        prompt: "Approve payment?",
        context: { amount: 100 },
        expires_at: null,
      },
      deps,
    );

    expect(ws.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws.send.mock.calls[0]![0] as string) as Record<
      string,
      unknown
    >;
    expect(sent).toMatchObject({
      request_id: "approval-7",
      type: "approval.request",
      payload: {
        approval_id: 7,
        plan_id: "plan-1",
        step_index: 2,
        prompt: "Approve payment?",
        context: { amount: 100 },
        expires_at: null,
      },
    });
  });

  it("skips node peers when selecting a local approval recipient", () => {
    const cm = new ConnectionManager();
    const { ws: nodeWs } = makeNode(cm, "node-1");
    const { ws: clientWs } = makeClient(cm, ["playwright"]);
    const deps = makeDeps(cm);

    requestApproval(
      {
        approval_id: 7,
        plan_id: "plan-1",
        step_index: 0,
        prompt: "Approve?",
        expires_at: null,
      },
      deps,
    );

    expect(nodeWs.send).not.toHaveBeenCalled();
    expect(clientWs.send).toHaveBeenCalledOnce();
  });

  it("does nothing when no clients are connected", () => {
    const cm = new ConnectionManager();
    const deps = makeDeps(cm);

    // Should not throw.
    requestApproval(
      {
        approval_id: 1,
        plan_id: "plan-1",
        step_index: 0,
        prompt: "Approve?",
        context: null,
        expires_at: null,
      },
      deps,
    );
  });
});

describe("pairing resolution", () => {
  it("closes node connections across cluster edges when pairing is approved", async () => {
    const cm = new ConnectionManager();
    const nodeId = "node-1";
    const { ws: nodeWs } = makeNode(cm, nodeId);

    const { id: clientConnId } = makeClient(cm, []);
    const client = cm.getClient(clientConnId)!;

    const pairing = {
      pairing_id: 1,
      status: "approved",
      requested_at: "2026-02-22T00:00:00Z",
      node: {
        node_id: nodeId,
        label: "Test node",
        capabilities: [],
        last_seen_at: "2026-02-22T00:00:00Z",
      },
      resolution: {
        decision: "approved",
        resolved_at: "2026-02-22T00:00:01Z",
        reason: "ok",
        resolved_by: { instance_id: client.instance_id },
      },
      resolved_at: "2026-02-22T00:00:01Z",
    };

    const enqueue = vi.fn(async () => ({}) as never);
    const deps = makeDeps(cm, {
      nodePairingService: { resolve: vi.fn(async () => pairing) } as never,
      cluster: {
        edgeId: "edge-a",
        outboxDal: { enqueue } as never,
        connectionDirectory: {} as never,
      },
    });

    const result = await handleClientMessage(
      client,
      JSON.stringify({ request_id: "r-1", type: "pairing.approve", payload: { node_id: nodeId } }),
      deps,
    );

    expect((result as { ok: boolean }).ok).toBe(true);
    expect(nodeWs.close).toHaveBeenCalledWith(1012, "pairing resolved; reconnect");

    const wsCloseCall = enqueue.mock.calls.find((call) => call[0] === "ws.close");
    expect(wsCloseCall).toBeDefined();
    expect(wsCloseCall![1]).toMatchObject({
      source_edge_id: "edge-a",
      skip_local: true,
      target_role: "node",
      instance_id: nodeId,
      code: 1012,
      reason: "pairing resolved; reconnect",
    });
  });
});

// ---------------------------------------------------------------------------
// sendPlanUpdate
// ---------------------------------------------------------------------------

describe("sendPlanUpdate", () => {
  it("broadcasts plan.update events to all connected clients", () => {
    const cm = new ConnectionManager();
    const { ws: ws1 } = makeClient(cm, ["playwright"]);
    const { ws: ws2 } = makeClient(cm, ["cli"]);
    const deps = makeDeps(cm);

    sendPlanUpdate("plan-1", "executing", deps, "step 2 of 5");

    expect(ws1.send).toHaveBeenCalledOnce();
    expect(ws2.send).toHaveBeenCalledOnce();

    const sent = JSON.parse(ws1.send.mock.calls[0]![0] as string) as Record<
      string,
      unknown
    >;
    expect(sent["type"]).toBe("plan.update");
    expect(typeof sent["event_id"]).toBe("string");
    expect(typeof sent["occurred_at"]).toBe("string");
    expect(sent["payload"]).toEqual({
      plan_id: "plan-1",
      status: "executing",
      detail: "step 2 of 5",
    });
  });

  it("sends plan.update without detail", () => {
    const cm = new ConnectionManager();
    const { ws } = makeClient(cm, ["playwright"]);
    const deps = makeDeps(cm);

    sendPlanUpdate("plan-1", "completed", deps);

    const sent = JSON.parse(ws.send.mock.calls[0]![0] as string) as Record<
      string,
      unknown
    >;
    expect(sent["type"]).toBe("plan.update");
    expect((sent["payload"] as Record<string, unknown>)["plan_id"]).toBe("plan-1");
    expect((sent["payload"] as Record<string, unknown>)["status"]).toBe("completed");
  });
});
