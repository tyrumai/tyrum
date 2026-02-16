/**
 * WebSocket protocol handler tests — verifies message parsing, dispatch
 * routing, task result handling, and human response handling.
 */

import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import {
  handleClientMessage,
  dispatchTask,
  requestHumanConfirmation,
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
    if (result!.type === "error") {
      expect(result!.code).toBe("invalid_json");
    }
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
    if (result!.type === "error") {
      expect(result!.code).toBe("invalid_message");
    }
  });

  it("returns error for unexpected hello", () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = handleClientMessage(
      client,
      JSON.stringify({ type: "hello", capabilities: ["playwright"] }),
      deps,
    );
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    if (result!.type === "error") {
      expect(result!.code).toBe("unexpected_hello");
    }
  });

  it("dispatches task_result to callback", () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult });

    const result = handleClientMessage(
      client,
      JSON.stringify({
        type: "task_result",
        task_id: "t-1",
        success: true,
        evidence: { screenshot: "base64..." },
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

  it("dispatches task_result with error", () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;
    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult });

    handleClientMessage(
      client,
      JSON.stringify({
        type: "task_result",
        task_id: "t-2",
        success: false,
        error: "command failed",
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

  it("dispatches human_response to callback", () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onHumanResponse = vi.fn();
    const deps = makeDeps(cm, { onHumanResponse });

    const result = handleClientMessage(
      client,
      JSON.stringify({
        type: "human_response",
        plan_id: "plan-1",
        approved: true,
      }),
      deps,
    );

    expect(result).toBeUndefined();
    expect(onHumanResponse).toHaveBeenCalledWith("plan-1", true, undefined);
  });

  it("dispatches human_response with rejection reason", () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onHumanResponse = vi.fn();
    const deps = makeDeps(cm, { onHumanResponse });

    handleClientMessage(
      client,
      JSON.stringify({
        type: "human_response",
        plan_id: "plan-2",
        approved: false,
        reason: "too risky",
      }),
      deps,
    );

    expect(onHumanResponse).toHaveBeenCalledWith("plan-2", false, "too risky");
  });

  it("updates lastPong on pong message", () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    // Set lastPong to something old.
    client.lastPong = 1000;

    const before = Date.now();
    const result = handleClientMessage(
      client,
      JSON.stringify({ type: "pong" }),
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
  it("sends task_dispatch to a capable client", () => {
    const cm = new ConnectionManager();
    const { ws } = makeClient(cm, ["playwright"]);
    const deps = makeDeps(cm);

    const action: ActionPrimitive = {
      type: "Web",
      args: { url: "https://example.com" },
    };

    const taskId = dispatchTask(action, "plan-1", 0, deps);
    expect(taskId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    expect(ws.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws.send.mock.calls[0]![0] as string) as Record<
      string,
      unknown
    >;
    expect(sent).toMatchObject({
      type: "task_dispatch",
      task_id: taskId,
      plan_id: "plan-1",
      action: { type: "Web", args: { url: "https://example.com" } },
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
// requestHumanConfirmation
// ---------------------------------------------------------------------------

describe("requestHumanConfirmation", () => {
  it("sends human_confirmation to the first client", () => {
    const cm = new ConnectionManager();
    const { ws } = makeClient(cm, ["playwright"]);
    const deps = makeDeps(cm);

    requestHumanConfirmation("plan-1", 2, "Approve payment?", { amount: 100 }, deps);

    expect(ws.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(ws.send.mock.calls[0]![0] as string) as Record<
      string,
      unknown
    >;
    expect(sent).toEqual({
      type: "human_confirmation",
      plan_id: "plan-1",
      step_index: 2,
      prompt: "Approve payment?",
      context: { amount: 100 },
    });
  });

  it("does nothing when no clients are connected", () => {
    const cm = new ConnectionManager();
    const deps = makeDeps(cm);

    // Should not throw.
    requestHumanConfirmation("plan-1", 0, "Approve?", null, deps);
  });
});

// ---------------------------------------------------------------------------
// sendPlanUpdate
// ---------------------------------------------------------------------------

describe("sendPlanUpdate", () => {
  it("broadcasts plan_update to all connected clients", () => {
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
    expect(sent).toEqual({
      type: "plan_update",
      plan_id: "plan-1",
      status: "executing",
      detail: "step 2 of 5",
    });
  });

  it("sends plan_update without detail", () => {
    const cm = new ConnectionManager();
    const { ws } = makeClient(cm, ["playwright"]);
    const deps = makeDeps(cm);

    sendPlanUpdate("plan-1", "completed", deps);

    const sent = JSON.parse(ws.send.mock.calls[0]![0] as string) as Record<
      string,
      unknown
    >;
    expect(sent).toMatchObject({
      type: "plan_update",
      plan_id: "plan-1",
      status: "completed",
    });
  });
});
