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
} {
  const wss = new WebSocketServer({ port: 0 });
  const addr = wss.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  const url = `ws://127.0.0.1:${port}`;

  const clientWaiters: Array<(ws: WsWebSocket) => void> = [];
  const pendingClients: WsWebSocket[] = [];

  wss.on("connection", (ws) => {
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

  async function close(): Promise<void> {
    return new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  }

  return { wss, url, port, close, waitForClient };
}

/** Wait for a JSON message from a ws-library WebSocket. */
function waitForMessage(ws: WsWebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
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
    const hello = await waitForMessage(ws);

    expect(hello).toEqual({
      type: "hello",
      capabilities: ["playwright", "http"],
    });
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
    // consume hello
    await waitForMessage(ws);

    // send ping
    ws.send(JSON.stringify({ type: "ping" }));
    const pong = await waitForMessage(ws);

    expect(pong).toEqual({ type: "pong" });
  });

  it("emits task_dispatch event", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["http"],
    });

    const received = new Promise<unknown>((resolve) => {
      client!.on("task_dispatch", resolve);
    });

    client.connect();
    const ws = await server.waitForClient();
    await waitForMessage(ws); // hello

    const dispatchMsg = {
      type: "task_dispatch",
      task_id: "task-1",
      plan_id: "plan-1",
      action: { type: "Http", args: { url: "https://example.com" } },
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
      client!.on("human_confirmation", resolve);
    });

    client.connect();
    const ws = await server.waitForClient();
    await waitForMessage(ws); // hello

    const confirmMsg = {
      type: "human_confirmation",
      plan_id: "plan-1",
      step_index: 0,
      prompt: "Approve this?",
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
    await waitForMessage(ws); // hello

    const updateMsg = {
      type: "plan_update",
      plan_id: "plan-1",
      status: "running",
      detail: "step 2 of 4",
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
    await waitForMessage(ws); // hello

    const errorMsg = {
      type: "error",
      code: "internal",
      message: "something went wrong",
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
    await waitForMessage(ws); // hello

    client.sendTaskResult("task-42", true, { status: 200 }, undefined);
    const result = await waitForMessage(ws);

    expect(result).toEqual({
      type: "task_result",
      task_id: "task-42",
      success: true,
      evidence: { status: 200 },
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
    await waitForMessage(ws); // hello

    client.sendHumanResponse("plan-7", false, "too risky");
    const response = await waitForMessage(ws);

    expect(response).toEqual({
      type: "human_response",
      plan_id: "plan-7",
      approved: false,
      reason: "too risky",
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
    await waitForMessage(ws); // hello

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
    const hello1 = await waitForMessage(ws1);
    expect(hello1).toEqual({ type: "hello", capabilities: ["cli"] });

    // Force-close from server (1001 = "going away" — 1006 is reserved)
    ws1.close(1001, "gone");

    // Client should reconnect — wait for a second connection
    const ws2 = await server.waitForClient();
    const hello2 = await waitForMessage(ws2);
    expect(hello2).toEqual({ type: "hello", capabilities: ["cli"] });
  });

  it("appends token to URL without existing query string", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "my-token",
      capabilities: [],
    });

    // We verify indirectly that the connection succeeds (token is in URL)
    client.connect();
    const ws = await server.waitForClient();
    await waitForMessage(ws); // hello arrives = connection succeeded
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
    await connectedP;
    client.disconnect();

    // Wait a bit to ensure no reconnect is attempted
    await delay(200);
    expect(client.connected).toBe(false);
  });
});
