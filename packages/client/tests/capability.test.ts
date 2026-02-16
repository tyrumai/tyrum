import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket as WsWebSocket } from "ws";
import { TyrumClient } from "../src/ws-client.js";
import { autoExecute } from "../src/capability.js";
import type { CapabilityProvider } from "../src/capability.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestServer(): {
  wss: WebSocketServer;
  url: string;
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

  return { wss, url, close, waitForClient };
}

function waitForMessage(ws: WsWebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("autoExecute", () => {
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

  it("routes task_dispatch to matching provider and sends result", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["http"],
      reconnect: false,
    });

    const httpProvider: CapabilityProvider = {
      capability: "http",
      execute: async () => ({
        success: true,
        evidence: { statusCode: 200 },
      }),
    };

    autoExecute(client, [httpProvider]);

    client.connect();
    const ws = await server.waitForClient();
    await waitForMessage(ws); // hello

    ws.send(
      JSON.stringify({
        type: "task_dispatch",
        task_id: "t-1",
        plan_id: "p-1",
        action: { type: "Http", args: { url: "https://example.com" } },
      }),
    );

    const result = await waitForMessage(ws);
    expect(result).toEqual({
      type: "task_result",
      task_id: "t-1",
      success: true,
      evidence: { statusCode: 200 },
    });
  });

  it("sends error result when no matching provider", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["http"],
      reconnect: false,
    });

    // No providers registered
    autoExecute(client, []);

    client.connect();
    const ws = await server.waitForClient();
    await waitForMessage(ws); // hello

    ws.send(
      JSON.stringify({
        type: "task_dispatch",
        task_id: "t-2",
        plan_id: "p-1",
        action: { type: "Http", args: {} },
      }),
    );

    const result = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(result["type"]).toBe("task_result");
    expect(result["task_id"]).toBe("t-2");
    expect(result["success"]).toBe(false);
    expect(result["error"]).toContain("no provider");
  });

  it("sends error result when provider throws", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["playwright"],
      reconnect: false,
    });

    const failProvider: CapabilityProvider = {
      capability: "playwright",
      execute: async () => {
        throw new Error("browser crashed");
      },
    };

    autoExecute(client, [failProvider]);

    client.connect();
    const ws = await server.waitForClient();
    await waitForMessage(ws); // hello

    ws.send(
      JSON.stringify({
        type: "task_dispatch",
        task_id: "t-3",
        plan_id: "p-1",
        action: { type: "Web", args: {} },
      }),
    );

    const result = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(result["type"]).toBe("task_result");
    expect(result["task_id"]).toBe("t-3");
    expect(result["success"]).toBe(false);
    expect(result["error"]).toBe("browser crashed");
  });
});
