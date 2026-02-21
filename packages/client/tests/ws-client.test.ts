import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket as WsWebSocket } from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TyrumClient } from "../src/ws-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Start a `ws` server on a random port and return the URL + cleanup. */
function createTestServer(): {
  wss: WebSocketServer;
  url: string;
  port: number;
  close: () => Promise<void>;
  waitForClient: () => Promise<WsWebSocket>;
  waitForProtocolHeader: () => Promise<string | string[] | undefined>;
} {
  const wss = new WebSocketServer({ port: 0 });
  const addr = wss.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  const url = `ws://127.0.0.1:${port}`;

  const clientWaiters: Array<(ws: WsWebSocket) => void> = [];
  const pendingClients: WsWebSocket[] = [];
  const protocolWaiters: Array<(value: string | string[] | undefined) => void> = [];
  const pendingProtocols: Array<string | string[] | undefined> = [];

  wss.on("connection", (ws, req) => {
    const offeredProtocols = req.headers["sec-websocket-protocol"];
    const protocolWaiter = protocolWaiters.shift();
    if (protocolWaiter) {
      protocolWaiter(offeredProtocols);
    } else {
      pendingProtocols.push(offeredProtocols);
    }

    const waiter = clientWaiters.shift();
    if (waiter) {
      waiter(ws);
    } else {
      pendingClients.push(ws);
    }
  });

  function waitForClient(): Promise<WsWebSocket> {
    const pending = pendingClients.shift();
    if (pending) return Promise.resolve(pending);
    return new Promise<WsWebSocket>((resolve) => {
      clientWaiters.push(resolve);
    });
  }

  function waitForProtocolHeader(): Promise<string | string[] | undefined> {
    const pending = pendingProtocols.shift();
    if (pending !== undefined) return Promise.resolve(pending);
    return new Promise<string | string[] | undefined>((resolve) => {
      protocolWaiters.push(resolve);
    });
  }

  async function close(): Promise<void> {
    return new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  }

  return { wss, url, port, close, waitForClient, waitForProtocolHeader };
}

/** Wait for a JSON message from a ws-library WebSocket. */
function waitForMessage(ws: WsWebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

let connectionSeq = 0;

async function acceptConnect(
  ws: WsWebSocket,
): Promise<{ connection_id: string; init: Record<string, unknown> }> {
  const init = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(init["type"]).toBe("connect.init");
  expect(typeof init["request_id"]).toBe("string");
  const initRequestId = String(init["request_id"]);

  connectionSeq += 1;
  const connectionId = `conn-${connectionSeq}`;
  const challenge = `nonce-${connectionSeq}`;

  ws.send(
    JSON.stringify({
      request_id: initRequestId,
      type: "connect.init",
      ok: true,
      result: { connection_id: connectionId, challenge },
    }),
  );

  const proof = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(proof["type"]).toBe("connect.proof");
  expect(typeof proof["request_id"]).toBe("string");
  expect((proof["payload"] as Record<string, unknown>)["connection_id"]).toBe(connectionId);

  ws.send(
    JSON.stringify({
      request_id: String(proof["request_id"]),
      type: "connect.proof",
      ok: true,
      result: {},
    }),
  );

  return { connection_id: connectionId, init };
}

/** Small delay helper. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TyrumClient", () => {
  let server: ReturnType<typeof createTestServer> | undefined;
  let client: TyrumClient | undefined;
  let tyrumHome: string | undefined;
  let prevTyrumHome: string | undefined;

  beforeEach(async () => {
    tyrumHome = await mkdtemp(join(tmpdir(), "tyrum-client-test-"));
    prevTyrumHome = process.env["TYRUM_HOME"];
    process.env["TYRUM_HOME"] = tyrumHome;
  });

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    if (server) {
      await server.close();
      server = undefined;
    }
    if (tyrumHome) {
      await rm(tyrumHome, { recursive: true, force: true });
      tyrumHome = undefined;
    }
    if (prevTyrumHome === undefined) {
      delete process.env["TYRUM_HOME"];
    } else {
      process.env["TYRUM_HOME"] = prevTyrumHome;
    }
    prevTyrumHome = undefined;
  });

  it("connects and sends hello with capabilities", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "test-token",
      capabilities: ["playwright", "http"],
      tyrumHome,
    });

    client.connect();
    const ws = await server.waitForClient();
    const { init } = await acceptConnect(ws);
    expect((init["payload"] as Record<string, unknown>)["role"]).toBe("client");
    expect((init["payload"] as Record<string, unknown>)["protocol_rev"]).toBe(1);
    expect((init["payload"] as Record<string, unknown>)["capabilities"]).toEqual([
      { name: "playwright" },
      { name: "http" },
    ]);
  });

  it("responds to ping with pong", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      tyrumHome,
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    // send ping
    ws.send(JSON.stringify({ request_id: "ping-1", type: "ping", payload: {} }));
    const pong = (await waitForMessage(ws)) as Record<string, unknown>;

    expect(pong).toEqual({ request_id: "ping-1", type: "ping", ok: true });
  });

  it("sessionSend sends session.send and returns the parsed result", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      tyrumHome,
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;

    const sendP = client.sessionSend({
      channel: "internal",
      thread_id: "thread-1",
      message: "hello",
    });

    const req = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(req["type"]).toBe("session.send");
    const requestId = String(req["request_id"]);
    ws.send(
      JSON.stringify({
        request_id: requestId,
        type: "session.send",
        ok: true,
        result: {
          reply: "hi",
          session_id: "internal:thread-1",
          used_tools: [],
          memory_written: false,
        },
      }),
    );

    await expect(sendP).resolves.toEqual({
      reply: "hi",
      session_id: "internal:thread-1",
      used_tools: [],
      memory_written: false,
    });
  });

  it("workflowRun sends workflow.run and returns the parsed result", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      tyrumHome,
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;

    const runP = client.workflowRun({
      key: "hook:00000000-0000-4000-8000-000000000001",
      lane: "main",
      pipeline: "steps:\n  - id: one\n    command: cli echo hello\n",
    });

    const req = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(req["type"]).toBe("workflow.run");
    const requestId = String(req["request_id"]);
    ws.send(
      JSON.stringify({
        request_id: requestId,
        type: "workflow.run",
        ok: true,
        result: {
          job_id: "job-1",
          run_id: "00000000-0000-4000-8000-000000000002",
          plan_id: `wf-${requestId}`,
        },
      }),
    );

    await expect(runP).resolves.toEqual({
      job_id: "job-1",
      run_id: "00000000-0000-4000-8000-000000000002",
      plan_id: `wf-${requestId}`,
    });
  });

  it("emits task_dispatch event", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["http"],
      tyrumHome,
    });

    const received = new Promise<unknown>((resolve) => {
      client!.on("task_execute", resolve);
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    const dispatchMsg = {
      request_id: "task-1",
      type: "task.execute",
      payload: {
        run_id: "00000000-0000-4000-8000-000000000001",
        step_id: "00000000-0000-4000-8000-000000000002",
        attempt_id: "00000000-0000-4000-8000-000000000003",
        action: { type: "Http", args: { url: "https://example.com" } },
      },
    };
    ws.send(JSON.stringify(dispatchMsg));

    const msg = await received;
    expect(msg).toEqual(dispatchMsg);
  });

  it("responds with error envelope when task.execute request fails validation", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["http"],
      reconnect: false,
      tyrumHome,
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    ws.send(
      JSON.stringify({
        request_id: "task-bad-1",
        type: "task.execute",
        payload: {
          run_id: "not-a-uuid",
          step_id: "00000000-0000-4000-8000-000000000002",
          attempt_id: "00000000-0000-4000-8000-000000000003",
          action: { type: "Http", args: { url: "https://example.com" } },
        },
      }),
    );

    const response = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(response["request_id"]).toBe("task-bad-1");
    expect(response["type"]).toBe("task.execute");
    expect(response["ok"]).toBe(false);
    expect((response["error"] as Record<string, unknown>)["code"]).toBe(
      "invalid_request",
    );
  });

  it("emits human_confirmation event", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });

    const received = new Promise<unknown>((resolve) => {
      client!.on("approval_request", resolve);
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    const confirmMsg = {
      request_id: "approval-7",
      type: "approval.request",
      payload: {
        approval_id: 7,
        plan_id: "plan-1",
        step_index: 0,
        prompt: "Approve this?",
      },
    };
    ws.send(JSON.stringify(confirmMsg));

    const msg = await received;
    expect(msg).toEqual(confirmMsg);
  });

  it("responds with error envelope when approval.request fails validation", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    ws.send(
      JSON.stringify({
        request_id: "approval-7",
        type: "approval.request",
        payload: {
          approval_id: "7",
          plan_id: "plan-1",
          step_index: 0,
          prompt: "Approve this?",
        },
      }),
    );

    const response = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(response["request_id"]).toBe("approval-7");
    expect(response["type"]).toBe("approval.request");
    expect(response["ok"]).toBe(false);
    expect((response["error"] as Record<string, unknown>)["code"]).toBe(
      "invalid_request",
    );
  });

  it("emits plan_update event", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });

    const received = new Promise<unknown>((resolve) => {
      client!.on("plan_update", resolve);
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    const updateMsg = {
      event_id: "evt-1",
      type: "plan.update",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        plan_id: "plan-1",
        status: "running",
        detail: "step 2 of 4",
      },
    };
    ws.send(JSON.stringify(updateMsg));

    const msg = await received;
    expect(msg).toEqual(updateMsg);
  });

  it("deduplicates events by event_id", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });

    const handler = vi.fn();
    const received = new Promise<void>((resolve) => {
      client!.on("plan_update", (evt) => {
        handler(evt);
        resolve();
      });
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    const updateMsg = {
      event_id: "evt-1",
      type: "plan.update",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        plan_id: "plan-1",
        status: "running",
        detail: "step 2 of 4",
      },
    };

    ws.send(JSON.stringify(updateMsg));
    ws.send(JSON.stringify(updateMsg));

    await received;
    await delay(25);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toEqual(updateMsg);
  });

  it("emits pairing_approved event", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });

    const received = new Promise<unknown>((resolve) => {
      client!.on("pairing_approved", resolve);
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    const approvedMsg = {
      event_id: "evt-pair-1",
      type: "pairing.approved",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        node_id: "node-1",
        scoped_token: "scoped-token-123",
        capabilities: ["cli"],
      },
    };
    ws.send(JSON.stringify(approvedMsg));

    const msg = await received;
    expect(msg).toEqual(approvedMsg);
  });

  it("emits error event for error messages", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });

    const received = new Promise<unknown>((resolve) => {
      client!.on("error", resolve);
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    const errorMsg = {
      event_id: "evt-err-1",
      type: "error",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        code: "internal",
        message: "something went wrong",
      },
    };
    ws.send(JSON.stringify(errorMsg));

    const msg = await received;
    expect(msg).toEqual(errorMsg);
  });

  it("sendTaskResult sends correct JSON", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    client.respondTaskExecute("task-42", true, undefined, { status: 200 }, undefined);
    const result = await waitForMessage(ws);

    expect(result).toEqual({
      request_id: "task-42",
      type: "task.execute",
      ok: true,
      result: { evidence: { status: 200 } },
    });
  });

  it("sendHumanResponse sends correct JSON", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    client.respondApprovalRequest("approval-7", false, "too risky");
    const response = await waitForMessage(ws);

    expect(response).toEqual({
      request_id: "approval-7",
      type: "approval.request",
      ok: true,
      result: { approved: false, reason: "too risky" },
    });
  });

  it("disconnects cleanly", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;

    expect(client.connected).toBe(true);
    client.disconnect();
    // After disconnect the property should reflect closed state
    expect(client.connected).toBe(false);
  });

  it("emits disconnected event with code and reason", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });

    const disconnectedP = new Promise<{ code: number; reason: string }>(
      (resolve) => {
        client!.on("disconnected", resolve);
      },
    );

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    // Server-initiated close
    ws.close(4100, "test-close");

    const disconnectInfo = await disconnectedP;
    expect(disconnectInfo.code).toBe(4100);
    expect(disconnectInfo.reason).toBe("test-close");
  });

  it("reconnects after unexpected close", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["cli"],
      reconnect: true,
      maxReconnectDelay: 500,
    });

    client.connect();
    const ws1 = await server.waitForClient();
    await acceptConnect(ws1);

    // Force-close from server (1001 = "going away" — 1006 is reserved)
    ws1.close(1001, "gone");

    // Client should reconnect — wait for a second connection
    const ws2 = await server.waitForClient();
    await acceptConnect(ws2);
  });

  it("sends token in websocket subprotocol metadata", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "my-token",
      capabilities: [],
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    const protocolHeader = await server.waitForProtocolHeader();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;
    expect(typeof protocolHeader).toBe("string");
    const offered = String(protocolHeader ?? "");
    expect(offered).toContain("tyrum-v1");
    expect(offered).toContain("tyrum-auth.");
    expect(client.connected).toBe(true);
  });

  it("does not reconnect after intentional disconnect", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: true,
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;
    client.disconnect();

    // Wait a bit to ensure no reconnect is attempted
    await delay(200);
    expect(client.connected).toBe(false);
  });
});
