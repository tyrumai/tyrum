import { describe, it, expect, afterEach, vi } from "vitest";
import { WebSocketServer } from "ws";
import type { WebSocket as WsWebSocket } from "ws";
import { generateKeyPairSync } from "node:crypto";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";
import * as deviceIdentity from "../src/device-identity.js";
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

async function acceptConnect(
  ws: WsWebSocket,
  clientId = "client-1",
): Promise<{ request_id: string }> {
  const init = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(init["type"]).toBe("connect.init");
  expect(typeof init["request_id"]).toBe("string");
  const initRequestId = String(init["request_id"]);

  ws.send(
    JSON.stringify({
      request_id: initRequestId,
      type: "connect.init",
      ok: true,
      result: { connection_id: "conn-1", challenge: "nonce-1" },
    }),
  );

  const proof = (await waitForMessage(ws)) as Record<string, unknown>;
  expect(proof["type"]).toBe("connect.proof");
  expect(typeof proof["request_id"]).toBe("string");
  const proofRequestId = String(proof["request_id"]);

  ws.send(
    JSON.stringify({
      request_id: proofRequestId,
      type: "connect.proof",
      ok: true,
      result: { client_id: clientId, device_id: "device-1", role: "client" },
    }),
  );

  return { request_id: proofRequestId };
}

/** Small delay helper. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    delay(ms).then(() => {
      throw new Error(`${label} timeout after ${ms}ms`);
    }),
  ]);
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
    vi.restoreAllMocks();
  });

  it("connects and sends connect.init with capability descriptors", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "test-token",
      capabilities: ["playwright", "http"],
    });

    client.connect();
    const ws = await server.waitForClient();
    const connect = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(connect["type"]).toBe("connect.init");
    expect(connect["payload"]).toEqual({
      protocol_rev: 2,
      role: "client",
      device: expect.objectContaining({
        device_id: expect.any(String),
        pubkey: expect.any(String),
      }),
      capabilities: [
        {
          id: descriptorIdForClientCapability("playwright"),
          version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
        },
        {
          id: descriptorIdForClientCapability("http"),
          version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
        },
      ],
    });
  });

  it("reuses one auto-generated device identity across concurrent resolution", async () => {
    client = new TyrumClient({
      url: "ws://127.0.0.1:65535",
      token: "t",
      capabilities: [],
      reconnect: false,
    });

    const firstIdentity = {
      deviceId: "device-A",
      publicKey: "pub-A",
      privateKey: "priv-A",
    };
    const secondIdentity = {
      deviceId: "device-B",
      publicKey: "pub-B",
      privateKey: "priv-B",
    };

    let resolveFirstIdentity!: (value: typeof firstIdentity) => void;
    let resolveSecondIdentity!: (value: typeof secondIdentity) => void;
    const firstIdentityPromise = new Promise<typeof firstIdentity>((resolve) => {
      resolveFirstIdentity = resolve;
    });
    const secondIdentityPromise = new Promise<typeof secondIdentity>((resolve) => {
      resolveSecondIdentity = resolve;
    });

    const createSpy = vi
      .spyOn(deviceIdentity, "createDeviceIdentity")
      .mockImplementationOnce(async () => await firstIdentityPromise)
      .mockImplementationOnce(async () => await secondIdentityPromise);

    const resolveConnectDevice = (
      client as unknown as {
        resolveConnectDevice: () => Promise<{
          publicKey: string;
          privateKey: string;
          deviceId: string;
        }>;
      }
    ).resolveConnectDevice.bind(client);

    const firstCall = resolveConnectDevice();
    const secondCall = resolveConnectDevice();

    resolveSecondIdentity(secondIdentity);
    await Promise.resolve();
    resolveFirstIdentity(firstIdentity);

    const [resolvedFirst, resolvedSecond] = await Promise.all([firstCall, secondCall]);
    const resolvedThird = await resolveConnectDevice();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(resolvedFirst).toEqual(firstIdentity);
    expect(resolvedSecond).toEqual(firstIdentity);
    expect(resolvedThird).toEqual(firstIdentity);
  });

  it("derives device id using shared base64url decoder", async () => {
    server = createTestServer();
    const spy = vi.spyOn(deviceIdentity, "fromBase64Url");
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
      role: "node",
      device: {
        publicKey: "AQID",
        privateKey: "BAUG",
      },
    });

    client.connect();
    const ws = await server.waitForClient();
    const init = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(init["type"]).toBe("connect.init");
    expect(spy).toHaveBeenCalled();
  });

  it("omits empty optional device strings in connect.init payload", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
      role: "node",
      device: {
        publicKey: "AQID",
        privateKey: "BAUG",
        deviceId: "",
        label: "",
        platform: "   ",
        version: "",
        mode: "",
      },
    });

    client.connect();
    const ws = await server.waitForClient();
    const init = (await waitForMessage(ws)) as Record<string, unknown>;

    expect(init["type"]).toBe("connect.init");
    const payload = init["payload"] as Record<string, unknown>;
    const device = payload["device"] as Record<string, unknown>;

    expect(typeof device["device_id"]).toBe("string");
    expect(String(device["device_id"]).length).toBeGreaterThan(0);
    expect(device["pubkey"]).toBe("AQID");
    expect(Object.prototype.hasOwnProperty.call(device, "label")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(device, "platform")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(device, "version")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(device, "mode")).toBe(false);
  });

  it("sends namespaced, versioned capability descriptors in connect.init", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["cli", "http"],
      reconnect: false,
      role: "node",
      device: {
        publicKey: "AQID",
        privateKey: "BAUG",
      },
    });

    client.connect();
    const ws = await server.waitForClient();
    const init = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(init["type"]).toBe("connect.init");

    const payload = init["payload"] as Record<string, unknown>;
    expect(payload["capabilities"]).toEqual([
      {
        id: descriptorIdForClientCapability("cli"),
        version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
      },
      {
        id: descriptorIdForClientCapability("http"),
        version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
      },
    ]);
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
        run_id: "550e8400-e29b-41d4-a716-446655440000",
        step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        action: { type: "Http", args: { url: "https://example.com" } },
      },
    };
    ws.send(JSON.stringify(dispatchMsg));

    const msg = await received;
    expect(msg).toEqual(dispatchMsg);
  });

  it("dedupes task.execute request retries by request_id across reconnect", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["http"],
      reconnect: true,
      maxReconnectDelay: 25,
    });

    let calls = 0;
    const firstReceivedP = new Promise<unknown>((resolve) => {
      client!.on("task_execute", (msg) => {
        calls += 1;
        resolve(msg);
      });
    });

    client.connect();
    const ws1 = await withTimeout(server.waitForClient(), 2_000, "ws1 connection");
    await acceptConnect(ws1);
    await delay(10);

    const dispatchMsg = {
      request_id: "task-1",
      type: "task.execute",
      payload: {
        run_id: "550e8400-e29b-41d4-a716-446655440000",
        step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        action: { type: "Http", args: { url: "https://example.com" } },
      },
    };
    ws1.send(JSON.stringify(dispatchMsg));

    const first = await withTimeout(firstReceivedP, 2_000, "task_execute (first)");
    expect(first).toEqual(dispatchMsg);
    expect(calls).toBe(1);

    client.respondTaskExecute("task-1", true, undefined, { status: 200 }, undefined);
    const response1 = await withTimeout(
      waitForMessage(ws1),
      2_000,
      "task.execute response (first)",
    );
    expect(response1).toEqual({
      request_id: "task-1",
      type: "task.execute",
      ok: true,
      result: { evidence: { status: 200 } },
    });

    // Simulate gateway retry after abnormal close.
    ws1.terminate();

    const ws2 = await withTimeout(server.waitForClient(), 2_000, "ws2 reconnect");
    await acceptConnect(ws2, "client-2");
    await delay(10);

    const response2P = withTimeout(waitForMessage(ws2), 2_000, "task.execute response (retry)");
    ws2.send(JSON.stringify(dispatchMsg));

    await delay(25);
    expect(calls).toBe(1);

    const response2 = await response2P;
    expect(response2).toEqual(response1);
  });

  it("does not re-emit task.execute retries even when maxSeenRequestIds is very small", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["http"],
      reconnect: false,
      maxSeenRequestIds: 2,
    });

    const seen: string[] = [];
    client.on("task_execute", (msg) => {
      seen.push(msg.request_id);
    });

    client.connect();
    const ws = await withTimeout(server.waitForClient(), 2_000, "ws connection");
    await acceptConnect(ws);
    await delay(10);

    const mk = (request_id: string) => ({
      request_id,
      type: "task.execute",
      payload: {
        run_id: "550e8400-e29b-41d4-a716-446655440000",
        step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        action: { type: "Http", args: { url: "https://example.com" } },
      },
    });

    ws.send(JSON.stringify(mk("task-1")));
    ws.send(JSON.stringify(mk("task-2")));
    ws.send(JSON.stringify(mk("task-3")));

    await withTimeout(
      (async () => {
        while (seen.length < 3) {
          await delay(5);
        }
      })(),
      2_000,
      "task_execute (3 unique)",
    );

    // Retry of task-1 should not re-emit even though maxSeenRequestIds is very small.
    ws.send(JSON.stringify(mk("task-1")));
    await delay(25);

    expect(seen).toHaveLength(3);
    expect(seen.filter((id) => id === "task-1")).toHaveLength(1);
  });

  it("responds with error envelope when task.execute request fails validation", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["http"],
      reconnect: false,
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
          step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
          action: { type: "Http", args: { url: "https://example.com" } },
        },
      }),
    );

    const response = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(response["request_id"]).toBe("task-bad-1");
    expect(response["type"]).toBe("task.execute");
    expect(response["ok"]).toBe(false);
    expect((response["error"] as Record<string, unknown>)["code"]).toBe("invalid_request");
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

  it("dedupes approval.request retries by request_id across reconnect", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: true,
      maxReconnectDelay: 25,
    });

    let calls = 0;
    const firstReceivedP = new Promise<unknown>((resolve) => {
      client!.on("approval_request", (msg) => {
        calls += 1;
        resolve(msg);
      });
    });

    client.connect();
    const ws1 = await withTimeout(server.waitForClient(), 2_000, "ws1 connection");
    await acceptConnect(ws1);
    await delay(10);

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
    ws1.send(JSON.stringify(confirmMsg));

    const first = await withTimeout(firstReceivedP, 2_000, "approval_request (first)");
    expect(first).toEqual(confirmMsg);
    expect(calls).toBe(1);

    client.respondApprovalRequest("approval-7", false, "too risky");
    const response1 = await withTimeout(
      waitForMessage(ws1),
      2_000,
      "approval.request response (first)",
    );
    expect(response1).toEqual({
      request_id: "approval-7",
      type: "approval.request",
      ok: true,
      result: { approved: false, reason: "too risky" },
    });

    ws1.terminate();

    const ws2 = await withTimeout(server.waitForClient(), 2_000, "ws2 reconnect");
    await acceptConnect(ws2, "client-2");
    await delay(10);

    const response2P = withTimeout(waitForMessage(ws2), 2_000, "approval.request response (retry)");
    ws2.send(JSON.stringify(confirmMsg));

    await delay(25);
    expect(calls).toBe(1);

    const response2 = await response2P;
    expect(response2).toEqual(response1);
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
    expect((response["error"] as Record<string, unknown>)["code"]).toBe("invalid_request");
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

  it("sends approval.list request and returns typed result", async () => {
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
    await delay(10);

    const pending = client.approvalList({ limit: 100 });
    const req = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(req["type"]).toBe("approval.list");
    expect(typeof req["request_id"]).toBe("string");

    ws.send(
      JSON.stringify({
        request_id: req["request_id"],
        type: "approval.list",
        ok: true,
        result: { approvals: [] },
      }),
    );

    const res = await pending;
    expect(res.approvals).toEqual([]);
  });

  it("sends approval.resolve request and returns typed result", async () => {
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
    await delay(10);

    const pending = client.approvalResolve({ approval_id: 7, decision: "approved" });
    const req = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(req["type"]).toBe("approval.resolve");
    expect(typeof req["request_id"]).toBe("string");

    ws.send(
      JSON.stringify({
        request_id: req["request_id"],
        type: "approval.resolve",
        ok: true,
        result: {
          approval: {
            approval_id: 7,
            kind: "other",
            status: "approved",
            prompt: "ok?",
            created_at: "2026-02-20T00:00:00Z",
            resolution: {
              decision: "approved",
              resolved_at: "2026-02-20T00:00:01Z",
            },
          },
        },
      }),
    );

    const res = await pending;
    expect(res.approval.approval_id).toBe(7);
    expect(res.approval.status).toBe("approved");
  });

  it("rejects pending requests immediately on disconnect", async () => {
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
    await delay(10);

    const pending = client.commandExecute("/help");
    const req = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(req["type"]).toBe("command.execute");

    client.disconnect();

    await expect(
      Promise.race([
        pending,
        delay(100).then(() => {
          throw new Error("expected pending request to reject on disconnect");
        }),
      ]),
    ).rejects.toThrow(/disconnected/i);
  });

  it("dedupes events by event_id", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });

    let calls = 0;
    client.on("plan_update", () => {
      calls += 1;
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    const updateMsg = {
      event_id: "evt-dup-1",
      type: "plan.update",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        plan_id: "plan-1",
        status: "running",
      },
    };

    ws.send(JSON.stringify(updateMsg));
    ws.send(JSON.stringify(updateMsg));

    await delay(25);
    expect(calls).toBe(1);
  });

  it("dedupes events by event_id across reconnect", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: true,
      maxReconnectDelay: 25,
    });

    let calls = 0;
    const firstReceivedP = new Promise<void>((resolve) => {
      client!.on("plan_update", () => {
        calls += 1;
        resolve();
      });
    });

    client.connect();
    const ws1 = await withTimeout(server.waitForClient(), 2_000, "ws1 connection");
    await acceptConnect(ws1);
    await delay(10);

    const updateMsg = {
      event_id: "evt-dup-1",
      type: "plan.update",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        plan_id: "plan-1",
        status: "running",
      },
    };

    ws1.send(JSON.stringify(updateMsg));
    await withTimeout(firstReceivedP, 2_000, "plan_update (first)");
    expect(calls).toBe(1);

    ws1.terminate();

    const ws2 = await withTimeout(server.waitForClient(), 2_000, "ws2 reconnect");
    await acceptConnect(ws2, "client-2");
    await delay(10);

    ws2.send(JSON.stringify(updateMsg));

    await delay(25);
    expect(calls).toBe(1);
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

    const disconnectedP = new Promise<{ code: number; reason: string }>((resolve) => {
      client!.on("disconnected", resolve);
    });

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
    expect(connect1["type"]).toBe("connect.init");
    expect(connect1["payload"]).toEqual(
      expect.objectContaining({
        protocol_rev: 2,
        role: "client",
        capabilities: [
          {
            id: descriptorIdForClientCapability("cli"),
            version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
          },
        ],
      }),
    );
    ws1.send(
      JSON.stringify({
        request_id: String(connect1["request_id"]),
        type: "connect.init",
        ok: true,
        result: { connection_id: "conn-1", challenge: "nonce-1" },
      }),
    );
    const proof1 = (await waitForMessage(ws1)) as Record<string, unknown>;
    expect(proof1["type"]).toBe("connect.proof");
    ws1.send(
      JSON.stringify({
        request_id: String(proof1["request_id"]),
        type: "connect.proof",
        ok: true,
        result: { client_id: "client-1", device_id: "dev-1", role: "client" },
      }),
    );

    // Force-close from server (1001 = "going away" — 1006 is reserved)
    ws1.close(1001, "gone");

    // Client should reconnect — wait for a second connection
    const ws2 = await server.waitForClient();
    const connect2 = (await waitForMessage(ws2)) as Record<string, unknown>;
    expect(connect2["type"]).toBe("connect.init");
    expect(connect2["payload"]).toEqual(
      expect.objectContaining({
        protocol_rev: 2,
        role: "client",
        capabilities: [
          {
            id: descriptorIdForClientCapability("cli"),
            version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
          },
        ],
      }),
    );
    ws2.send(
      JSON.stringify({
        request_id: String(connect2["request_id"]),
        type: "connect.init",
        ok: true,
        result: { connection_id: "conn-2", challenge: "nonce-2" },
      }),
    );
    const proof2 = (await waitForMessage(ws2)) as Record<string, unknown>;
    expect(proof2["type"]).toBe("connect.proof");
    ws2.send(
      JSON.stringify({
        request_id: String(proof2["request_id"]),
        type: "connect.proof",
        ok: true,
        result: { client_id: "client-2", device_id: "dev-2", role: "client" },
      }),
    );
  });

  it("reconnects when socket closes mid device-proof handshake", async () => {
    server = createTestServer();

    const keyPair = generateKeyPairSync("ed25519");
    const publicKeyDer = keyPair.publicKey.export({ format: "der", type: "spki" }) as Uint8Array;
    const privateKeyDer = keyPair.privateKey.export({ format: "der", type: "pkcs8" }) as Uint8Array;

    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: true,
      maxReconnectDelay: 25,
      role: "node",
      device: {
        publicKey: Buffer.from(publicKeyDer).toString("base64url"),
        privateKey: Buffer.from(privateKeyDer).toString("base64url"),
      },
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    if (!globalThis.crypto?.subtle) {
      throw new Error("WebCrypto subtle API not available");
    }

    const originalSign = globalThis.crypto.subtle.sign.bind(globalThis.crypto.subtle);
    let didReject = false;
    const signRejectedP = new Promise<void>((resolve) => {
      vi.spyOn(globalThis.crypto.subtle!, "sign").mockImplementation(async (...args) => {
        if (!didReject) {
          didReject = true;
          await delay(50);
          resolve();
          throw new Error("test sign failure");
        }
        return await originalSign(...(args as Parameters<typeof originalSign>));
      });
    });

    client.connect();

    // First connection: server responds to connect.init then closes immediately.
    const ws1 = await withTimeout(server.waitForClient(), 2_000, "ws1 connection");
    const init1 = (await withTimeout(waitForMessage(ws1), 2_000, "ws1 connect.init")) as Record<
      string,
      unknown
    >;
    expect(init1["type"]).toBe("connect.init");
    ws1.send(
      JSON.stringify({
        request_id: String(init1["request_id"]),
        type: "connect.init",
        ok: true,
        result: { connection_id: "conn-1", challenge: "nonce-1" },
      }),
    );
    ws1.terminate();

    // Second connection: wait for the reconnect, then complete the handshake.
    const ws2 = await withTimeout(server.waitForClient(), 2_000, "ws2 reconnect");
    const init2 = (await withTimeout(waitForMessage(ws2), 2_000, "ws2 connect.init")) as Record<
      string,
      unknown
    >;
    expect(init2["type"]).toBe("connect.init");
    ws2.send(
      JSON.stringify({
        request_id: String(init2["request_id"]),
        type: "connect.init",
        ok: true,
        result: { connection_id: "conn-2", challenge: "nonce-2" },
      }),
    );

    const proof2 = (await withTimeout(waitForMessage(ws2), 2_000, "ws2 connect.proof")) as Record<
      string,
      unknown
    >;
    expect(proof2["type"]).toBe("connect.proof");

    // Ensure stale handshake work has a chance to fail while the new socket is alive.
    await withTimeout(signRejectedP, 2_000, "sign rejection");

    ws2.send(
      JSON.stringify({
        request_id: String(proof2["request_id"]),
        type: "connect.proof",
        ok: true,
        result: { client_id: "client-2", device_id: "dev-2", role: "node" },
      }),
    );

    await withTimeout(connectedP, 2_000, "connected");
    expect(client.connected).toBe(true);
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
