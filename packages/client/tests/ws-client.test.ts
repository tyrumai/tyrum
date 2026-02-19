import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket as WsWebSocket } from "ws";
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

async function acceptConnect(ws: WsWebSocket, clientId = "client-1"): Promise<{ request_id: string }> {
  const connect = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(connect["type"]).toBe("connect");
  expect(typeof connect["request_id"]).toBe("string");
  const requestId = String(connect["request_id"]);

  ws.send(
    JSON.stringify({
      request_id: requestId,
      type: "connect",
      ok: true,
      result: { client_id: clientId },
    }),
  );

  return { request_id: requestId };
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

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  it("connects and sends hello with capabilities", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "test-token",
      capabilities: ["playwright", "http"],
    });

    client.connect();
    const ws = await server.waitForClient();
    const connect = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(connect["type"]).toBe("connect");
    expect(connect["payload"]).toEqual({ capabilities: ["playwright", "http"] });
  });

  it("responds to ping with pong", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    // send ping
    ws.send(JSON.stringify({ request_id: "ping-1", type: "ping", payload: {} }));
    const pong = (await waitForMessage(ws)) as Record<string, unknown>;

    expect(pong).toEqual({ request_id: "ping-1", type: "ping", ok: true });
  });

  it("emits task_dispatch event", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["http"],
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
        plan_id: "plan-1",
        step_index: 0,
        action: { type: "Http", args: { url: "https://example.com" } },
      },
    };
    ws.send(JSON.stringify(dispatchMsg));

    const msg = await received;
    expect(msg).toEqual(dispatchMsg);
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
    const connect1 = (await waitForMessage(ws1)) as Record<string, unknown>;
    expect(connect1["type"]).toBe("connect");
    expect(connect1["payload"]).toEqual({ capabilities: ["cli"] });
    ws1.send(
      JSON.stringify({
        request_id: String(connect1["request_id"]),
        type: "connect",
        ok: true,
        result: { client_id: "client-1" },
      }),
    );

    // Force-close from server (1001 = "going away" — 1006 is reserved)
    ws1.close(1001, "gone");

    // Client should reconnect — wait for a second connection
    const ws2 = await server.waitForClient();
    const connect2 = (await waitForMessage(ws2)) as Record<string, unknown>;
    expect(connect2["type"]).toBe("connect");
    expect(connect2["payload"]).toEqual({ capabilities: ["cli"] });
    ws2.send(
      JSON.stringify({
        request_id: String(connect2["request_id"]),
        type: "connect",
        ok: true,
        result: { client_id: "client-2" },
      }),
    );
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
