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

  it("emits plan.update wire event name", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });

    const received = new Promise<unknown>((resolve) => {
      client!.on("plan.update", resolve as (data: never) => void);
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await delay(10);

    const updateMsg = {
      event_id: "evt-1-wire",
      type: "plan.update",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        plan_id: "plan-1",
        status: "running",
      },
    };
    ws.send(JSON.stringify(updateMsg));

    const msg = await received;
    expect(msg).toEqual(updateMsg);
  });

  it("emits additional protocol events by wire event type", async () => {
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

    const cases = [
      {
        type: "run.queued",
        payload: {
          run_id: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
      {
        type: "typing.started",
        payload: {
          session_id: "session-1",
        },
      },
      {
        type: "message.delta",
        payload: {
          session_id: "session-1",
          message_id: "msg-1",
          role: "assistant",
          delta: "hel",
        },
      },
      {
        type: "presence.pruned",
        payload: {
          instance_id: "instance-1",
        },
      },
      {
        type: "routing.config.updated",
        payload: {
          revision: 2,
        },
      },
      {
        type: "memory.item.created",
        payload: {
          item: {
            v: 1,
            memory_item_id: "123e4567-e89b-12d3-a456-426614174000",
            agent_id: "agent-1",
            kind: "note",
            tags: ["demo"],
            sensitivity: "private",
            provenance: { source_kind: "operator", refs: [] },
            created_at: "2026-02-19T12:00:00Z",
            body_md: "Remember this.",
          },
        },
      },
      {
        type: "memory.export.completed",
        payload: {
          artifact_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        },
      },
    ] as const;

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const receivedP = new Promise<unknown>((resolve) => {
        client!.on(c.type as never, resolve as (data: never) => void);
      });

      const event = {
        event_id: `evt-wire-${i}`,
        type: c.type,
        occurred_at: "2026-02-19T12:00:00Z",
        payload: c.payload,
      };
      ws.send(JSON.stringify(event));

      const received = await withTimeout(receivedP, 2_000, `${c.type} event`);
      expect(received).toEqual(event);
    }
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

  it("sends typed control-plane requests for session/workflow/pairing/presence", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["http"],
      reconnect: false,
    });

    const approvedPairing = {
      pairing: {
        pairing_id: 11,
        status: "approved",
        trust_level: "remote",
        requested_at: "2026-02-21T12:00:00Z",
        node: {
          node_id: "node-1",
          capabilities: ["http"],
          last_seen_at: "2026-02-21T12:00:00Z",
        },
        capability_allowlist: [
          {
            id: descriptorIdForClientCapability("http"),
            version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
          },
        ],
        resolution: {
          decision: "approved",
          resolved_at: "2026-02-21T12:00:10Z",
          reason: "looks good",
        },
        resolved_at: "2026-02-21T12:00:10Z",
      },
    };

    const deniedPairing = {
      pairing: {
        pairing_id: 11,
        status: "denied",
        requested_at: "2026-02-21T12:00:00Z",
        node: {
          node_id: "node-1",
          capabilities: ["http"],
          last_seen_at: "2026-02-21T12:00:00Z",
        },
        capability_allowlist: [],
        resolution: {
          decision: "denied",
          resolved_at: "2026-02-21T12:00:11Z",
          reason: "not trusted",
        },
        resolved_at: "2026-02-21T12:00:11Z",
      },
    };

    const revokedPairing = {
      pairing: {
        pairing_id: 11,
        status: "revoked",
        requested_at: "2026-02-21T12:00:00Z",
        node: {
          node_id: "node-1",
          capabilities: ["http"],
          last_seen_at: "2026-02-21T12:00:00Z",
        },
        capability_allowlist: [],
        resolution: {
          decision: "revoked",
          resolved_at: "2026-02-21T12:00:12Z",
          reason: "removed",
        },
        resolved_at: "2026-02-21T12:00:12Z",
      },
    };

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await delay(10);

    const pingP = client.ping();
    const pingReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(pingReq["type"]).toBe("ping");
    expect(pingReq["payload"]).toEqual({});
    ws.send(
      JSON.stringify({
        request_id: pingReq["request_id"],
        type: "ping",
        ok: true,
      }),
    );
    await expect(pingP).resolves.toBeUndefined();

    const sendP = client.sessionSend({
      channel: "telegram",
      thread_id: "thread-1",
      content: "hello world",
    });
    const sendReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(sendReq["type"]).toBe("session.send");
    ws.send(
      JSON.stringify({
        request_id: sendReq["request_id"],
        type: "session.send",
        ok: true,
        result: { session_id: "session-1", assistant_message: "ok" },
      }),
    );
    await expect(sendP).resolves.toEqual({ session_id: "session-1", assistant_message: "ok" });

    const runP = client.workflowRun({
      key: "agent:agent-1:main",
      steps: [{ type: "Http", args: { url: "https://example.com" } }],
    });
    const runReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(runReq["type"]).toBe("workflow.run");
    ws.send(
      JSON.stringify({
        request_id: runReq["request_id"],
        type: "workflow.run",
        ok: true,
        result: {
          job_id: "job-1",
          run_id: "run-1",
          plan_id: "plan-1",
          request_id: "req-1",
          key: "agent:agent-1:main",
          lane: "main",
          steps_count: 1,
        },
      }),
    );
    await expect(runP).resolves.toEqual({
      job_id: "job-1",
      run_id: "run-1",
      plan_id: "plan-1",
      request_id: "req-1",
      key: "agent:agent-1:main",
      lane: "main",
      steps_count: 1,
    });

    const resumeP = client.workflowResume({ token: "resume-token-1" });
    const resumeReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(resumeReq["type"]).toBe("workflow.resume");
    ws.send(
      JSON.stringify({
        request_id: resumeReq["request_id"],
        type: "workflow.resume",
        ok: true,
        result: { run_id: "run-1" },
      }),
    );
    await expect(resumeP).resolves.toEqual({ run_id: "run-1" });

    const cancelP = client.workflowCancel({ run_id: "run-1", reason: "operator cancel" });
    const cancelReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(cancelReq["type"]).toBe("workflow.cancel");
    ws.send(
      JSON.stringify({
        request_id: cancelReq["request_id"],
        type: "workflow.cancel",
        ok: true,
        result: { run_id: "run-1", cancelled: true },
      }),
    );
    await expect(cancelP).resolves.toEqual({ run_id: "run-1", cancelled: true });

    const approveP = client.pairingApprove({
      pairing_id: 11,
      trust_level: "remote",
      capability_allowlist: [
        {
          id: descriptorIdForClientCapability("http"),
          version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
        },
      ],
    });
    const approveReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(approveReq["type"]).toBe("pairing.approve");
    ws.send(
      JSON.stringify({
        request_id: approveReq["request_id"],
        type: "pairing.approve",
        ok: true,
        result: approvedPairing,
      }),
    );
    await expect(approveP).resolves.toEqual(approvedPairing);

    const denyP = client.pairingDeny({ pairing_id: 11, reason: "denied" });
    const denyReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(denyReq["type"]).toBe("pairing.deny");
    ws.send(
      JSON.stringify({
        request_id: denyReq["request_id"],
        type: "pairing.deny",
        ok: true,
        result: deniedPairing,
      }),
    );
    await expect(denyP).resolves.toEqual(deniedPairing);

    const revokeP = client.pairingRevoke({ pairing_id: 11, reason: "revoked" });
    const revokeReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(revokeReq["type"]).toBe("pairing.revoke");
    ws.send(
      JSON.stringify({
        request_id: revokeReq["request_id"],
        type: "pairing.revoke",
        ok: true,
        result: revokedPairing,
      }),
    );
    await expect(revokeP).resolves.toEqual(revokedPairing);

    const beaconP = client.presenceBeacon({
      mode: "ui",
      host: "operator-host",
      last_input_seconds: 5,
    });
    const beaconReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(beaconReq["type"]).toBe("presence.beacon");
    ws.send(
      JSON.stringify({
        request_id: beaconReq["request_id"],
        type: "presence.beacon",
        ok: true,
        result: {
          entry: {
            instance_id: "instance-1",
            role: "client",
            host: "operator-host",
            mode: "ui",
            last_seen_at: "2026-02-21T12:01:00Z",
          },
        },
      }),
    );
    await expect(beaconP).resolves.toEqual({
      entry: {
        instance_id: "instance-1",
        role: "client",
        host: "operator-host",
        mode: "ui",
        last_seen_at: "2026-02-21T12:01:00Z",
      },
    });

    const readyP = client.capabilityReady({
      capabilities: [
        {
          id: descriptorIdForClientCapability("http"),
          version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
        },
      ],
    });
    const readyReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(readyReq["type"]).toBe("capability.ready");
    ws.send(
      JSON.stringify({
        request_id: readyReq["request_id"],
        type: "capability.ready",
        ok: true,
      }),
    );
    await expect(readyP).resolves.toBeUndefined();

    const evidenceP = client.attemptEvidence({
      run_id: "550e8400-e29b-41d4-a716-446655440000",
      step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
      attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      evidence: { logs: ["ok"] },
    });
    const evidenceReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(evidenceReq["type"]).toBe("attempt.evidence");
    ws.send(
      JSON.stringify({
        request_id: evidenceReq["request_id"],
        type: "attempt.evidence",
        ok: true,
      }),
    );
    await expect(evidenceP).resolves.toBeUndefined();
  });

  it("sends typed work.* requests and returns validated results", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;

    const scope = { tenant_id: "t-1", agent_id: "agent-1", workspace_id: "default" };

    const workItem = {
      work_item_id: "123e4567-e89b-12d3-a456-426614174000",
      ...scope,
      kind: "action",
      title: "Test item",
      status: "backlog",
      priority: 0,
      created_at: "2026-02-19T12:00:00Z",
      created_from_session_key: "agent:agent-1:main",
      last_active_at: null,
      fingerprint: { resources: ["repo:example/repo"] },
      acceptance: { checks: [] },
      budgets: null,
      parent_work_item_id: null,
    };

    const workArtifact = {
      artifact_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      ...scope,
      work_item_id: workItem.work_item_id,
      kind: "candidate_plan",
      title: "Plan",
      body_md: "- step 1",
      refs: [],
      created_at: "2026-02-19T12:00:00Z",
    };

    const decision = {
      decision_id: "550e8400-e29b-41d4-a716-446655440000",
      ...scope,
      work_item_id: workItem.work_item_id,
      question: "Q?",
      chosen: "A",
      alternatives: ["B"],
      rationale_md: "Because",
      input_artifact_ids: [workArtifact.artifact_id],
      created_at: "2026-02-19T12:00:00Z",
    };

    const signal = {
      signal_id: "11111111-2222-3333-8aaa-555555555555",
      ...scope,
      work_item_id: workItem.work_item_id,
      trigger_kind: "time",
      trigger_spec_json: { at: "tomorrow" },
      payload_json: { note: "ping" },
      status: "active",
      created_at: "2026-02-19T12:00:00Z",
      last_fired_at: null,
    };

    const stateKvEntry = {
      ...scope,
      work_item_id: workItem.work_item_id,
      key: "branch",
      value_json: { name: "main" },
      updated_at: "2026-02-19T12:00:00Z",
    };

    async function expectWorkRequest<T>(
      call: () => Promise<T>,
      expectedType: string,
      payload: unknown,
      result: unknown,
    ): Promise<T> {
      const pending = call();
      const req = (await waitForMessage(ws)) as Record<string, unknown>;
      expect(req["type"]).toBe(expectedType);
      expect(req["payload"]).toEqual(payload);

      ws.send(
        JSON.stringify({
          request_id: req["request_id"],
          type: expectedType,
          ok: true,
          result,
        }),
      );

      return await pending;
    }

    const listPayload = { ...scope, limit: 1 };
    const listRes = await expectWorkRequest(
      () => client!.workList(listPayload),
      "work.list",
      listPayload,
      { items: [workItem], next_cursor: "cursor-1" },
    );
    expect(listRes.items[0].work_item_id).toBe(workItem.work_item_id);

    const getPayload = { ...scope, work_item_id: workItem.work_item_id };
    const getRes = await expectWorkRequest(
      () => client!.workGet(getPayload),
      "work.get",
      getPayload,
      {
        item: workItem,
      },
    );
    expect(getRes.item.work_item_id).toBe(workItem.work_item_id);

    const createPayload = { ...scope, item: { kind: "action", title: "Test item" } };
    const createRes = await expectWorkRequest(
      () => client!.workCreate(createPayload),
      "work.create",
      createPayload,
      { item: workItem },
    );
    expect(createRes.item.work_item_id).toBe(workItem.work_item_id);

    const updatePayload = {
      ...scope,
      work_item_id: workItem.work_item_id,
      patch: { title: "Updated" },
    };
    const updateRes = await expectWorkRequest(
      () => client!.workUpdate(updatePayload),
      "work.update",
      updatePayload,
      { item: workItem },
    );
    expect(updateRes.item.work_item_id).toBe(workItem.work_item_id);

    const transitionPayload = {
      ...scope,
      work_item_id: workItem.work_item_id,
      status: "doing",
    };
    const transitionRes = await expectWorkRequest(
      () => client!.workTransition(transitionPayload),
      "work.transition",
      transitionPayload,
      { item: workItem },
    );
    expect(transitionRes.item.work_item_id).toBe(workItem.work_item_id);

    const artifactListPayload = { ...scope, work_item_id: workItem.work_item_id };
    const artifactListRes = await expectWorkRequest(
      () => client!.workArtifactList(artifactListPayload),
      "work.artifact.list",
      artifactListPayload,
      { artifacts: [workArtifact], next_cursor: "cursor-2" },
    );
    expect(artifactListRes.artifacts[0].artifact_id).toBe(workArtifact.artifact_id);

    const artifactGetPayload = { ...scope, artifact_id: workArtifact.artifact_id };
    const artifactGetRes = await expectWorkRequest(
      () => client!.workArtifactGet(artifactGetPayload),
      "work.artifact.get",
      artifactGetPayload,
      { artifact: workArtifact },
    );
    expect(artifactGetRes.artifact.artifact_id).toBe(workArtifact.artifact_id);

    const artifactCreatePayload = {
      ...scope,
      artifact: { kind: "candidate_plan", title: "Plan" },
    };
    const artifactCreateRes = await expectWorkRequest(
      () => client!.workArtifactCreate(artifactCreatePayload),
      "work.artifact.create",
      artifactCreatePayload,
      { artifact: workArtifact },
    );
    expect(artifactCreateRes.artifact.artifact_id).toBe(workArtifact.artifact_id);

    const decisionListPayload = { ...scope, work_item_id: workItem.work_item_id };
    const decisionListRes = await expectWorkRequest(
      () => client!.workDecisionList(decisionListPayload),
      "work.decision.list",
      decisionListPayload,
      { decisions: [decision], next_cursor: "cursor-3" },
    );
    expect(decisionListRes.decisions[0].decision_id).toBe(decision.decision_id);

    const decisionGetPayload = { ...scope, decision_id: decision.decision_id };
    const decisionGetRes = await expectWorkRequest(
      () => client!.workDecisionGet(decisionGetPayload),
      "work.decision.get",
      decisionGetPayload,
      { decision },
    );
    expect(decisionGetRes.decision.decision_id).toBe(decision.decision_id);

    const decisionCreatePayload = {
      ...scope,
      decision: { question: "Q?", chosen: "A", rationale_md: "Because" },
    };
    const decisionCreateRes = await expectWorkRequest(
      () => client!.workDecisionCreate(decisionCreatePayload),
      "work.decision.create",
      decisionCreatePayload,
      { decision },
    );
    expect(decisionCreateRes.decision.decision_id).toBe(decision.decision_id);

    const signalListPayload = { ...scope, work_item_id: workItem.work_item_id };
    const signalListRes = await expectWorkRequest(
      () => client!.workSignalList(signalListPayload),
      "work.signal.list",
      signalListPayload,
      { signals: [signal], next_cursor: "cursor-4" },
    );
    expect(signalListRes.signals[0].signal_id).toBe(signal.signal_id);

    const signalGetPayload = { ...scope, signal_id: signal.signal_id };
    const signalGetRes = await expectWorkRequest(
      () => client!.workSignalGet(signalGetPayload),
      "work.signal.get",
      signalGetPayload,
      { signal },
    );
    expect(signalGetRes.signal.signal_id).toBe(signal.signal_id);

    const signalCreatePayload = {
      ...scope,
      signal: { trigger_kind: "time", trigger_spec_json: { at: "tomorrow" } },
    };
    const signalCreateRes = await expectWorkRequest(
      () => client!.workSignalCreate(signalCreatePayload),
      "work.signal.create",
      signalCreatePayload,
      { signal },
    );
    expect(signalCreateRes.signal.signal_id).toBe(signal.signal_id);

    const signalUpdatePayload = { ...scope, signal_id: signal.signal_id, patch: {} };
    const signalUpdateRes = await expectWorkRequest(
      () => client!.workSignalUpdate(signalUpdatePayload),
      "work.signal.update",
      signalUpdatePayload,
      { signal },
    );
    expect(signalUpdateRes.signal.signal_id).toBe(signal.signal_id);

    const kvGetPayload = { scope: { ...scope, kind: "agent" }, key: "prefs.timezone" };
    const kvGetRes = await expectWorkRequest(
      () => client!.workStateKvGet(kvGetPayload),
      "work.state_kv.get",
      kvGetPayload,
      { entry: null },
    );
    expect(kvGetRes.entry).toBeNull();

    const kvListPayload = {
      scope: { ...scope, kind: "work_item", work_item_id: workItem.work_item_id },
    };
    const kvListRes = await expectWorkRequest(
      () => client!.workStateKvList(kvListPayload),
      "work.state_kv.list",
      kvListPayload,
      { entries: [] },
    );
    expect(kvListRes.entries).toEqual([]);

    const kvSetPayload = {
      scope: { ...scope, kind: "work_item", work_item_id: workItem.work_item_id },
      key: "branch",
      value_json: { name: "main" },
    };
    const kvSetRes = await expectWorkRequest(
      () => client!.workStateKvSet(kvSetPayload),
      "work.state_kv.set",
      kvSetPayload,
      { entry: stateKvEntry },
    );
    expect(kvSetRes.entry.key).toBe("branch");
  });

  it("sends typed memory.* requests and returns validated results", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;

    const noteItem = {
      v: 1,
      memory_item_id: "123e4567-e89b-12d3-a456-426614174000",
      agent_id: "agent-1",
      kind: "note",
      tags: ["demo"],
      sensitivity: "private",
      provenance: { source_kind: "operator", refs: [] },
      created_at: "2026-02-19T12:00:00Z",
      body_md: "Remember this.",
    };

    const tombstone = {
      v: 1,
      memory_item_id: noteItem.memory_item_id,
      agent_id: noteItem.agent_id,
      deleted_at: "2026-02-19T12:00:01Z",
      deleted_by: "operator",
      reason: "cleanup",
    };

    async function expectMemoryRequest<T>(
      call: () => Promise<T>,
      expectedType: string,
      payload: unknown,
      result: unknown,
    ): Promise<T> {
      const pending = call();
      const req = (await waitForMessage(ws)) as Record<string, unknown>;
      expect(req["type"]).toBe(expectedType);
      expect(req["payload"]).toEqual(payload);

      ws.send(
        JSON.stringify({
          request_id: req["request_id"],
          type: expectedType,
          ok: true,
          result,
        }),
      );

      return await pending;
    }

    const searchPayload = { v: 1, query: "remember", limit: 1 };
    const searchRes = await expectMemoryRequest(
      () => client!.memorySearch(searchPayload),
      "memory.search",
      searchPayload,
      { v: 1, hits: [{ memory_item_id: noteItem.memory_item_id, kind: noteItem.kind, score: 1 }] },
    );
    expect(searchRes.v).toBe(1);
    expect(searchRes.hits[0].memory_item_id).toBe(noteItem.memory_item_id);

    const listPayload = { v: 1, limit: 1 };
    const listRes = await expectMemoryRequest(
      () => client!.memoryList(listPayload),
      "memory.list",
      listPayload,
      { v: 1, items: [noteItem] },
    );
    expect(listRes.items[0].memory_item_id).toBe(noteItem.memory_item_id);

    const getPayload = { v: 1, memory_item_id: noteItem.memory_item_id };
    const getRes = await expectMemoryRequest(
      () => client!.memoryGet(getPayload),
      "memory.get",
      getPayload,
      { v: 1, item: noteItem },
    );
    expect(getRes.item.memory_item_id).toBe(noteItem.memory_item_id);

    const createPayload = {
      v: 1,
      item: {
        kind: "note",
        tags: ["demo"],
        sensitivity: "private",
        provenance: { source_kind: "operator", refs: [] },
        body_md: noteItem.body_md,
      },
    };
    const createRes = await expectMemoryRequest(
      () => client!.memoryCreate(createPayload),
      "memory.create",
      createPayload,
      { v: 1, item: noteItem },
    );
    expect(createRes.item.memory_item_id).toBe(noteItem.memory_item_id);

    const updatePayload = {
      v: 1,
      memory_item_id: noteItem.memory_item_id,
      patch: { body_md: "Updated memory." },
    };
    const updateRes = await expectMemoryRequest(
      () => client!.memoryUpdate(updatePayload),
      "memory.update",
      updatePayload,
      {
        v: 1,
        item: { ...noteItem, body_md: "Updated memory.", updated_at: "2026-02-19T12:00:02Z" },
      },
    );
    expect(updateRes.item.body_md).toBe("Updated memory.");

    const deletePayload = { v: 1, memory_item_id: noteItem.memory_item_id, reason: "cleanup" };
    const deleteRes = await expectMemoryRequest(
      () => client!.memoryDelete(deletePayload),
      "memory.delete",
      deletePayload,
      { v: 1, tombstone },
    );
    expect(deleteRes.tombstone.memory_item_id).toBe(noteItem.memory_item_id);

    const forgetPayload = {
      v: 1,
      confirm: "FORGET",
      selectors: [{ kind: "id", memory_item_id: noteItem.memory_item_id }],
    };
    const forgetRes = await expectMemoryRequest(
      () => client!.memoryForget(forgetPayload),
      "memory.forget",
      forgetPayload,
      { v: 1, deleted_count: 1, tombstones: [tombstone] },
    );
    expect(forgetRes.deleted_count).toBe(1);

    const exportPayload = { v: 1, include_tombstones: false };
    const exportRes = await expectMemoryRequest(
      () => client!.memoryExport(exportPayload),
      "memory.export",
      exportPayload,
      { v: 1, artifact_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e" },
    );
    expect(exportRes.artifact_id).toBe("0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e");

    const getErrP = client!.memoryGet(getPayload);
    const getErrReq = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(getErrReq["type"]).toBe("memory.get");

    ws.send(
      JSON.stringify({
        request_id: getErrReq["request_id"],
        type: "memory.get",
        ok: false,
        error: { code: "not_found", message: "nope" },
      }),
    );
    await expect(getErrP).rejects.toThrow(/not_found/i);
  });

  it("rejects memory.* helper responses with invalid result payloads", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;

    const payload = { v: 1, memory_item_id: "123e4567-e89b-12d3-a456-426614174000" };
    const pending = client!.memoryGet(payload);
    const req = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(req["type"]).toBe("memory.get");
    expect(req["payload"]).toEqual(payload);

    ws.send(
      JSON.stringify({
        request_id: req["request_id"],
        type: "memory.get",
        ok: true,
        result: { v: 1 },
      }),
    );

    await expect(pending).rejects.toThrow(/returned invalid result/i);
  });

  it("sends typed subagent.* requests and returns validated results", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;

    const scope = { tenant_id: "t-1", agent_id: "agent-1", workspace_id: "default" };
    const workItemId = "11111111-2222-3333-8aaa-555555555555";
    const workItemTaskId = "22222222-3333-4444-8aaa-555555555555";
    const subagentId = "123e4567-e89b-12d3-a456-426614174000";

    const subagent = {
      subagent_id: subagentId,
      ...scope,
      work_item_id: workItemId,
      work_item_task_id: workItemTaskId,
      execution_profile: "subagent",
      session_key: `agent:${scope.agent_id}:subagent:${subagentId}`,
      lane: "subagent",
      status: "running",
      created_at: "2026-02-19T12:00:00Z",
      last_heartbeat_at: null,
    };

    async function expectSubagentRequest<T>(
      call: () => Promise<T>,
      expectedType: string,
      payload: unknown,
      result: unknown,
    ): Promise<T> {
      const pending = call();
      const req = (await waitForMessage(ws)) as Record<string, unknown>;
      expect(req["type"]).toBe(expectedType);
      expect(req["payload"]).toEqual(payload);

      ws.send(
        JSON.stringify({
          request_id: req["request_id"],
          type: expectedType,
          ok: true,
          result,
        }),
      );

      return await pending;
    }

    const spawnPayload = {
      ...scope,
      execution_profile: "subagent",
      work_item_id: workItemId,
      work_item_task_id: workItemTaskId,
    };
    const spawnRes = await expectSubagentRequest(
      () => client!.subagentSpawn(spawnPayload),
      "subagent.spawn",
      spawnPayload,
      { subagent },
    );
    expect(spawnRes.subagent.subagent_id).toBe(subagentId);

    const listPayload = { ...scope, statuses: ["running"], limit: 1 };
    const listRes = await expectSubagentRequest(
      () => client!.subagentList(listPayload),
      "subagent.list",
      listPayload,
      { subagents: [subagent] },
    );
    expect(listRes.subagents[0].subagent_id).toBe(subagentId);

    const getPayload = { ...scope, subagent_id: subagentId };
    const getRes = await expectSubagentRequest(
      () => client!.subagentGet(getPayload),
      "subagent.get",
      getPayload,
      { subagent },
    );
    expect(getRes.subagent.subagent_id).toBe(subagentId);

    const sendPayload = { ...scope, subagent_id: subagentId, content: "hello" };
    const sendRes = await expectSubagentRequest(
      () => client!.subagentSend(sendPayload),
      "subagent.send",
      sendPayload,
      { accepted: true },
    );
    expect(sendRes.accepted).toBe(true);

    const closeSubagent = {
      ...subagent,
      status: "closed",
      closed_at: "2026-02-19T12:00:01Z",
    };
    const closePayload = { ...scope, subagent_id: subagentId, reason: "done" };
    const closeRes = await expectSubagentRequest(
      () => client!.subagentClose(closePayload),
      "subagent.close",
      closePayload,
      { subagent: closeSubagent },
    );
    expect(closeRes.subagent.status).toBe("closed");
  });

  it("rejects invalid subagent.* payloads without sending", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;

    const outbound: unknown[] = [];
    ws.on("message", (data) => {
      outbound.push(JSON.parse(data.toString()));
    });

    const scope = { tenant_id: "t-1", agent_id: "agent-1", workspace_id: "default" };
    const invalidPayload = {
      ...scope,
      subagent_id: "123e4567-e89b-12d3-a456-426614174000",
      content: "   ",
    };

    await expect(
      withTimeout(
        client!.subagentSend(invalidPayload as any),
        200,
        "subagent.send invalid payload",
      ),
    ).rejects.toThrow(/invalid payload/i);

    await delay(25);
    expect(outbound).toEqual([]);
  });

  it("emits subagent.* events", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    const scope = { tenant_id: "t-1", agent_id: "agent-1", workspace_id: "default" };
    const workItemId = "11111111-2222-3333-8aaa-555555555555";
    const workItemTaskId = "22222222-3333-4444-8aaa-555555555555";
    const subagentId = "123e4567-e89b-12d3-a456-426614174000";
    const subagent = {
      subagent_id: subagentId,
      ...scope,
      work_item_id: workItemId,
      work_item_task_id: workItemTaskId,
      execution_profile: "subagent",
      session_key: `agent:${scope.agent_id}:subagent:${subagentId}`,
      lane: "subagent",
      status: "running",
      created_at: "2026-02-19T12:00:00Z",
      last_heartbeat_at: null,
    };

    const spawnedReceivedP = new Promise<unknown>((resolve) => {
      client!.on("subagent.spawned", resolve);
    });
    const outputReceivedP = new Promise<unknown>((resolve) => {
      client!.on("subagent.output", resolve);
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;

    const spawnedMsg = {
      event_id: "evt-subagent-1",
      type: "subagent.spawned",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: { subagent },
    };
    ws.send(JSON.stringify(spawnedMsg));

    const outputMsg = {
      event_id: "evt-subagent-2",
      type: "subagent.output",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        ...scope,
        subagent_id: subagentId,
        work_item_id: workItemId,
        work_item_task_id: workItemTaskId,
        kind: "delta",
        content: "hello",
      },
    };
    ws.send(JSON.stringify(outputMsg));

    await expect(withTimeout(spawnedReceivedP, 2_000, "subagent.spawned")).resolves.toEqual(
      spawnedMsg,
    );
    await expect(withTimeout(outputReceivedP, 2_000, "subagent.output")).resolves.toEqual(
      outputMsg,
    );
  });

  it("rejects void helper responses with non-empty ack payloads", async () => {
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

    const pending = client.ping();
    const req = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(req["type"]).toBe("ping");

    ws.send(
      JSON.stringify({
        request_id: req["request_id"],
        type: "ping",
        ok: true,
        result: { unexpected: true },
      }),
    );

    await expect(pending).rejects.toThrow(/returned invalid result/i);
  });

  it("rejects helper request when response type mismatches", async () => {
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

    const pending = client.sessionSend({
      channel: "telegram",
      thread_id: "thread-1",
      content: "hello",
    });
    const req = (await waitForMessage(ws)) as Record<string, unknown>;
    expect(req["type"]).toBe("session.send");

    ws.send(
      JSON.stringify({
        request_id: req["request_id"],
        type: "workflow.run",
        ok: true,
        result: {
          session_id: "session-1",
          assistant_message: "ok",
        },
      }),
    );

    await expect(pending).rejects.toThrow(/mismatched response type/i);
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

  it("dedupes work.* events by event_id", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });

    const connectedP = new Promise<void>((resolve) => {
      client!.on("connected", () => resolve());
    });

    let calls = 0;
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const firstReceivedP = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const secondReceivedP = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });

    client.on("work.item.updated", () => {
      calls += 1;
      if (calls === 1) resolveFirst();
      if (calls === 2) resolveSecond();
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;

    const scope = { tenant_id: "t-1", agent_id: "agent-1", workspace_id: "default" };
    const workItem = {
      work_item_id: "123e4567-e89b-12d3-a456-426614174000",
      ...scope,
      kind: "action",
      title: "Test item",
      status: "backlog",
      priority: 0,
      created_at: "2026-02-19T12:00:00Z",
      created_from_session_key: "agent:agent-1:main",
      last_active_at: null,
      fingerprint: { resources: ["repo:example/repo"] },
      acceptance: { checks: [] },
      budgets: null,
      parent_work_item_id: null,
    };

    const updateMsg = {
      event_id: "evt-work-dup-1",
      type: "work.item.updated",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: { item: workItem },
    };

    ws.send(JSON.stringify(updateMsg));
    ws.send(JSON.stringify(updateMsg));

    await withTimeout(firstReceivedP, 2_000, "first work.item.updated");
    await expect(
      Promise.race([secondReceivedP.then(() => "second"), delay(50).then(() => "timeout")]),
    ).resolves.toBe("timeout");
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

  it("schedules reconnect attempts every 5 seconds by default", async () => {
    server = createTestServer();
    client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: true,
    });

    const reconnectScheduledP = new Promise<{
      delayMs: number;
      nextRetryAtMs: number;
      attempt: number;
    }>((resolve) => {
      client!.on("reconnect_scheduled", resolve);
    });

    client.connect();
    const ws1 = await server.waitForClient();
    await acceptConnect(ws1);

    ws1.close(1001, "gone");

    const reconnectSchedule = await withTimeout(
      reconnectScheduledP,
      2_000,
      "reconnect_scheduled",
    );
    expect(reconnectSchedule.delayMs).toBe(5_000);
    expect(reconnectSchedule.attempt).toBe(1);
    expect(reconnectSchedule.nextRetryAtMs).toBeGreaterThan(Date.now());
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
