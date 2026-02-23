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
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
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
  const id = cm.addClient(ws as never, capabilities as never);
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
      JSON.stringify({ request_id: "r-1", type: "connect", payload: { capabilities: ["playwright"] } }),
      deps,
    );
    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    expect((result as unknown as { error: { code: string } }).error.code).toBe(
      "unsupported_request",
    );
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

  it("handles approval.list requests when approvalDal is configured", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;

    const approvalDal = {
      getPending: vi.fn(async () => {
        return [
          {
            id: 1,
            plan_id: "p-1",
            step_index: 0,
            prompt: "Approve?",
            context: { x: 1 },
            status: "pending",
            created_at: "2026-02-20 22:00:00",
            responded_at: null,
            response_reason: null,
            expires_at: null,
          },
        ];
      }),
      getByStatus: vi.fn(async () => []),
      respond: vi.fn(async () => undefined),
    };

    const deps = makeDeps(cm, { approvalDal: approvalDal as never });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-1",
        type: "approval.list",
        payload: {},
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    const res = result as unknown as { result: { approvals: Array<{ approval_id: number; created_at: string; resolution: unknown }> } };
    expect(res.result.approvals[0]!.approval_id).toBe(1);
    expect(res.result.approvals[0]!.created_at).toContain("T");
    expect(res.result.approvals[0]!.created_at).toContain("Z");
    expect(res.result.approvals[0]!.resolution).toBeNull();
  });

  it("handles approval.resolve requests when approvalDal is configured", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;

    const approvalDal = {
      getPending: vi.fn(async () => []),
      getByStatus: vi.fn(async () => []),
      respond: vi.fn(async () => {
        return {
          id: 2,
          plan_id: "p-2",
          step_index: 1,
          prompt: "Ok?",
          context: {},
          status: "approved",
          created_at: "2026-02-20 22:00:00",
          responded_at: "2026-02-20 22:00:05",
          response_reason: "looks good",
          expires_at: null,
        };
      }),
    };

    const deps = makeDeps(cm, { approvalDal: approvalDal as never });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-2",
        type: "approval.resolve",
        payload: { approval_id: 2, decision: "approved", reason: "looks good" },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(true);
    const res = result as unknown as { result: { approval: { approval_id: number; status: string; resolution: { decision: string } } } };
    expect(res.result.approval.approval_id).toBe(2);
    expect(res.result.approval.status).toBe("approved");
    expect(res.result.approval.resolution.decision).toBe("approved");
  });

  it("rejects pairing.approve when trust_level is missing", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;
    const nodePairingDal = { resolve: vi.fn(async () => undefined) };
    const deps = makeDeps(cm, { nodePairingDal: nodePairingDal as never });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-approve-1",
        type: "pairing.approve",
        payload: { pairing_id: 1, capability_allowlist: [] },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    expect((result as unknown as { error: { code: string } }).error.code).toBe("invalid_request");
    expect(nodePairingDal.resolve).not.toHaveBeenCalled();
  });

  it("rejects pairing.approve when capability_allowlist is missing", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;
    const nodePairingDal = { resolve: vi.fn(async () => undefined) };
    const deps = makeDeps(cm, { nodePairingDal: nodePairingDal as never });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-approve-2",
        type: "pairing.approve",
        payload: { pairing_id: 1, trust_level: "remote" },
      }),
      deps,
    );

    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    expect((result as unknown as { error: { code: string } }).error.code).toBe("invalid_request");
    expect(nodePairingDal.resolve).not.toHaveBeenCalled();
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

    const taskId = await dispatchTask(action, "plan-1", 0, deps);
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
        plan_id: "plan-1",
        step_index: 0,
        action: { type: "Web", args: { url: "https://example.com" } },
      },
    });
  });

  it("does not dispatch to an unpaired node", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, ["cli"] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
    });

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () => ({ status: "pending" }) as never,
      } as never,
    });

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    await expect(dispatchTask(action, "plan-1", 0, deps)).rejects.toBeInstanceOf(
      NoCapableClientError,
    );
    expect(nodeWs.send).not.toHaveBeenCalled();
  });

  it("dispatches to a paired node and prefers nodes over legacy clients", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, ["cli"] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
    });
    const { ws: legacyWs } = makeClient(cm, ["cli"]);

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () => ({ status: "approved" }) as never,
      } as never,
    });

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    const taskId = await dispatchTask(action, "plan-1", 0, deps);
    expect(taskId).toMatch(/^task-[0-9a-f-]{36}$/);
    expect(nodeWs.send).toHaveBeenCalledOnce();
    expect(legacyWs.send).not.toHaveBeenCalled();
  });

  it("falls back to legacy clients when nodes are unpaired", async () => {
    const cm = new ConnectionManager();
    const nodeWs = createMockWs();
    cm.addClient(nodeWs as never, ["cli"] as never, {
      id: "node-1",
      role: "node",
      deviceId: "dev_test",
      protocolRev: 2,
    });
    const { ws: legacyWs } = makeClient(cm, ["cli"]);

    const deps = makeDeps(cm, {
      nodePairingDal: {
        getByNodeId: async () => ({ status: "pending" }) as never,
      } as never,
    });

    const action: ActionPrimitive = {
      type: "CLI",
      args: { command: "echo hi" },
    };

    const taskId = await dispatchTask(action, "plan-1", 0, deps);
    expect(taskId).toMatch(/^task-[0-9a-f-]{36}$/);
    expect(nodeWs.send).not.toHaveBeenCalled();
    expect(legacyWs.send).toHaveBeenCalledOnce();
  });

  it("throws NoCapableClientError when no client has the capability", () => {
    const cm = new ConnectionManager();
    makeClient(cm, ["cli"]); // Only CLI capability
    const deps = makeDeps(cm);

    const action: ActionPrimitive = {
      type: "Web",
      args: {},
    };

    expect(() => dispatchTask(action, "plan-1", 0, deps)).toThrow(
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

    expect(() => dispatchTask(action, "plan-1", 0, deps)).toThrow(
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

    expect(() => dispatchTask(action, "plan-1", 0, deps)).toThrow(
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
