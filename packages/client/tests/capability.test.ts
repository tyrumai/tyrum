import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket as WsWebSocket } from "ws";
import { TyrumClient } from "../src/ws-client.js";
import { autoExecute } from "../src/capability.js";
import type { CapabilityProvider, TaskExecuteContext } from "../src/capability.js";

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

async function acceptConnect(ws: WsWebSocket, clientId = "client-1"): Promise<void> {
  const init = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(init["type"]).toBe("connect.init");
  ws.send(
    JSON.stringify({
      request_id: String(init["request_id"]),
      type: "connect.init",
      ok: true,
      result: { connection_id: "conn-1", challenge: "nonce-1" },
    }),
  );

  const proof = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(proof["type"]).toBe("connect.proof");
  ws.send(
    JSON.stringify({
      request_id: String(proof["request_id"]),
      type: "connect.proof",
      ok: true,
      result: { client_id: clientId, device_id: "device-1", role: "client" },
    }),
  );
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

  it("routes task.execute to matching provider and sends response", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["http"],
      reconnect: false,
    });

    const expectedContext = {
      requestId: "t-1",
      runId: "550e8400-e29b-41d4-a716-446655440000",
      stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
      attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
    } satisfies TaskExecuteContext;
    const httpProvider: CapabilityProvider = {
      capability: "http",
      execute: async (action, ctx?: TaskExecuteContext) => {
        expect(action.type).toBe("Http");
        expect(ctx).toEqual(expectedContext);
        return {
          success: true,
          evidence: { statusCode: 200 },
        };
      },
    };

    autoExecute(client, [httpProvider]);

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    ws.send(
      JSON.stringify({
        request_id: "t-1",
        type: "task.execute",
        payload: {
          run_id: expectedContext.runId,
          step_id: expectedContext.stepId,
          attempt_id: expectedContext.attemptId,
          action: { type: "Http", args: { url: "https://example.com" } },
        },
      }),
    );

    const result = await waitForMessage(ws);
    expect(result).toEqual({
      request_id: "t-1",
      type: "task.execute",
      ok: true,
      result: { evidence: { statusCode: 200 } },
    });
  });

  it("forwards provider result payload in task.execute response", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["http"],
      reconnect: false,
    });

    const expectedContext = {
      requestId: "t-1",
      runId: "550e8400-e29b-41d4-a716-446655440000",
      stepId: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
      attemptId: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
    } satisfies TaskExecuteContext;

    const httpProvider: CapabilityProvider = {
      capability: "http",
      execute: async (_action, ctx) => {
        expect(ctx).toEqual(expectedContext);
        return {
          success: true,
          result: { ok: true },
          evidence: { statusCode: 200 },
        };
      },
    };

    autoExecute(client, [httpProvider]);

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    ws.send(
      JSON.stringify({
        request_id: "t-1",
        type: "task.execute",
        payload: {
          run_id: expectedContext.runId,
          step_id: expectedContext.stepId,
          attempt_id: expectedContext.attemptId,
          action: { type: "Http", args: { url: "https://example.com" } },
        },
      }),
    );

    const result = await waitForMessage(ws);
    expect(result).toEqual({
      request_id: "t-1",
      type: "task.execute",
      ok: true,
      result: { result: { ok: true }, evidence: { statusCode: 200 } },
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
    await acceptConnect(ws);

    ws.send(
      JSON.stringify({
        request_id: "t-2",
        type: "task.execute",
        payload: {
          run_id: "550e8400-e29b-41d4-a716-446655440000",
          step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
          action: { type: "Http", args: {} },
        },
      }),
    );

    const result = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(result["type"]).toBe("task.execute");
    expect(result["request_id"]).toBe("t-2");
    expect(result["ok"]).toBe(false);
    const error = result["error"] as Record<string, unknown>;
    expect(String(error["message"])).toContain("no provider");
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
    await acceptConnect(ws);

    ws.send(
      JSON.stringify({
        request_id: "t-3",
        type: "task.execute",
        payload: {
          run_id: "550e8400-e29b-41d4-a716-446655440000",
          step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
          action: { type: "Web", args: { op: "navigate" } },
        },
      }),
    );

    const result = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(result["type"]).toBe("task.execute");
    expect(result["request_id"]).toBe("t-3");
    expect(result["ok"]).toBe(false);
    const error = result["error"] as Record<string, unknown>;
    expect(error["message"]).toBe("browser crashed");
  });

  it("sends error result when provider throws synchronously", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["playwright"],
      reconnect: false,
    });

    const failProvider: CapabilityProvider = {
      capability: "playwright",
      execute: (): Promise<{ success: boolean }> => {
        throw new Error("sync crash");
      },
    };

    autoExecute(client, [failProvider]);

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    ws.send(
      JSON.stringify({
        request_id: "t-4",
        type: "task.execute",
        payload: {
          run_id: "550e8400-e29b-41d4-a716-446655440000",
          step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
          action: { type: "Web", args: { op: "navigate" } },
        },
      }),
    );

    const result = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(result["type"]).toBe("task.execute");
    expect(result["request_id"]).toBe("t-4");
    expect(result["ok"]).toBe(false);
    const error = result["error"] as Record<string, unknown>;
    expect(error["message"]).toBe("sync crash");
  });

  it("sends error result when provider returns non-serializable payload", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["http"],
      reconnect: false,
    });

    const badProvider: CapabilityProvider = {
      capability: "http",
      execute: async () => ({
        success: true,
        evidence: { value: BigInt(1) },
      }),
    };

    autoExecute(client, [badProvider]);

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    ws.send(
      JSON.stringify({
        request_id: "t-5",
        type: "task.execute",
        payload: {
          run_id: "550e8400-e29b-41d4-a716-446655440000",
          step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
          action: { type: "Http", args: { url: "https://example.com" } },
        },
      }),
    );

    const result = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(result["type"]).toBe("task.execute");
    expect(result["request_id"]).toBe("t-5");
    expect(result["ok"]).toBe(false);
    const error = result["error"] as Record<string, unknown>;
    expect(String(error["message"])).toContain("serialization failed");
  });
});
