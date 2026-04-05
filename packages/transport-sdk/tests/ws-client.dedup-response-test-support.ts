import { expect, it } from "vitest";
import { TyrumClient } from "../src/ws-client.js";
import {
  type TestServer,
  createTestServer,
  waitForMessage,
  acceptConnect,
  delay,
  withTimeout,
} from "./ws-client.test-support.js";

type DedupFixture = {
  getServer: () => TestServer | undefined;
  setServer: (s: TestServer) => void;
  getClient: () => TyrumClient | undefined;
  setClient: (c: TyrumClient) => void;
};

function registerDedupRequestTests(fixture: DedupFixture): void {
  it("dedupes task.execute request retries by request_id across reconnect", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["desktop"],
      reconnect: true,
      maxReconnectDelay: 25,
    });
    fixture.setClient(client);

    let calls = 0;
    const firstReceivedP = new Promise<unknown>((resolve) => {
      client.on("task_execute", (msg) => {
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
        turn_id: "550e8400-e29b-41d4-a716-446655440000",
        dispatch_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
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
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["desktop"],
      reconnect: false,
      maxSeenRequestIds: 2,
    });
    fixture.setClient(client);

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
        turn_id: "550e8400-e29b-41d4-a716-446655440000",
        dispatch_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
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
}

function registerDedupEventTests(fixture: DedupFixture): void {
  it("dedupes events by event_id", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });
    fixture.setClient(client);

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
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });
    fixture.setClient(client);

    const connectedP = new Promise<void>((resolve) => {
      client.on("connected", () => resolve());
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

    const scope = {
      tenant_id: "11111111-1111-4111-8111-111111111111",
      agent_id: "22222222-2222-4222-8222-222222222222",
      workspace_id: "33333333-3333-4333-8333-333333333333",
    };
    const workItem = {
      work_item_id: "123e4567-e89b-12d3-a456-426614174000",
      ...scope,
      kind: "action",
      title: "Test item",
      status: "backlog",
      priority: 0,
      created_at: "2026-02-19T12:00:00Z",
      created_from_conversation_key: "agent:agent-1:main",
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
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: true,
      maxReconnectDelay: 25,
    });
    fixture.setClient(client);

    let calls = 0;
    const firstReceivedP = new Promise<void>((resolve) => {
      client.on("plan_update", () => {
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
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });
    fixture.setClient(client);

    const received = new Promise<unknown>((resolve) => {
      client.on("error", resolve);
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
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });
    fixture.setClient(client);

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
}

export function registerDedupResponseTests(fixture: DedupFixture): void {
  registerDedupRequestTests(fixture);
  registerDedupEventTests(fixture);
}
