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
  const id = cm.addClient(ws as never, capabilities as never);
  return { id, ws };
}

// ---------------------------------------------------------------------------
// handleClientMessage
// ---------------------------------------------------------------------------

describe("handleClientMessage", () => {
  it("returns error for invalid JSON", () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = handleClientMessage(client, "not json{{{", deps);
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string } }).payload;
    expect(payload.code).toBe("invalid_json");
  });

  it("returns error for invalid message schema", () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = handleClientMessage(
      client,
      JSON.stringify({ type: "unknown_type" }),
      deps,
    );
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string } }).payload;
    expect(payload.code).toBe("invalid_message");
  });

  it("returns error response for client-sent request envelopes", () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = handleClientMessage(
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

  it("dispatches task.execute response to callback", () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult });

    const result = handleClientMessage(
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

  it("dispatches task.execute error response", () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;
    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult });

    handleClientMessage(
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

  it("dispatches approval.request decision to callback", () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });

    const result = handleClientMessage(
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

  it("dispatches approval.request rejection with reason", () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onApprovalDecision = vi.fn();
    const deps = makeDeps(cm, { onApprovalDecision });

    handleClientMessage(
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

  it("updates lastPong on ping response", () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    // Set lastPong to something old.
    client.lastPong = 1000;

    const before = Date.now();
    const result = handleClientMessage(
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
  it("sends task.execute request to a capable client", () => {
    const cm = new ConnectionManager();
    const { ws } = makeClient(cm, ["playwright"]);
    const deps = makeDeps(cm);

    const action: ActionPrimitive = {
      type: "Web",
      args: { url: "https://example.com" },
    };

    const taskId = dispatchTask(action, "plan-1", 0, deps);
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
