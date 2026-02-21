import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket as WsWebSocket } from "ws";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function acceptConnect(ws: WsWebSocket, clientId = "client-1"): Promise<void> {
  const init = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(init["type"]).toBe("connect.init");
  const initRequestId = String(init["request_id"]);

  ws.send(
    JSON.stringify({
      request_id: initRequestId,
      type: "connect.init",
      ok: true,
      result: { connection_id: clientId, challenge: "nonce" },
    }),
  );

  const proof = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(proof["type"]).toBe("connect.proof");
  ws.send(
    JSON.stringify({
      request_id: String(proof["request_id"]),
      type: "connect.proof",
      ok: true,
      result: {},
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("autoExecute", () => {
  let server: ReturnType<typeof createTestServer> | undefined;
  let client: TyrumClient | undefined;
  let tyrumHome: string | undefined;
  let prevTyrumHome: string | undefined;

  beforeEach(async () => {
    tyrumHome = await mkdtemp(join(tmpdir(), "tyrum-client-capability-"));
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

  it("routes task.execute to matching provider and sends response", async () => {
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
    await acceptConnect(ws);

    ws.send(
      JSON.stringify({
        request_id: "t-1",
        type: "task.execute",
        payload: {
          run_id: "00000000-0000-4000-8000-000000000001",
          step_id: "00000000-0000-4000-8000-000000000002",
          attempt_id: "00000000-0000-4000-8000-000000000003",
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
          run_id: "00000000-0000-4000-8000-000000000001",
          step_id: "00000000-0000-4000-8000-000000000002",
          attempt_id: "00000000-0000-4000-8000-000000000003",
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
          run_id: "00000000-0000-4000-8000-000000000001",
          step_id: "00000000-0000-4000-8000-000000000002",
          attempt_id: "00000000-0000-4000-8000-000000000003",
          action: { type: "Web", args: {} },
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
});
