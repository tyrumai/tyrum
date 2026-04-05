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

type EventsFixture = {
  getServer: () => TestServer | undefined;
  setServer: (s: TestServer) => void;
  getClient: () => TyrumClient | undefined;
  setClient: (c: TyrumClient) => void;
};

function registerEventsBasicTests(fixture: EventsFixture): void {
  it("responds to ping with pong", async () => {
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

    // send ping
    ws.send(JSON.stringify({ request_id: "ping-1", type: "ping", payload: {} }));
    const pong = (await waitForMessage(ws)) as Record<string, unknown>;

    expect(pong).toEqual({ request_id: "ping-1", type: "ping", ok: true });
  });

  it("emits task_dispatch event", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["desktop"],
    });
    fixture.setClient(client);

    const received = new Promise<unknown>((resolve) => {
      client.on("task_execute", resolve);
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    const dispatchMsg = {
      request_id: "task-1",
      type: "task.execute",
      payload: {
        turn_id: "550e8400-e29b-41d4-a716-446655440000",
        dispatch_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        action: { type: "Http", args: { url: "https://example.com" } },
      },
    };
    ws.send(JSON.stringify(dispatchMsg));

    const msg = await received;
    expect(msg).toEqual(dispatchMsg);
  });

  it("responds with error envelope when task.execute request fails validation", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: ["desktop"],
      reconnect: false,
    });
    fixture.setClient(client);

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);

    ws.send(
      JSON.stringify({
        request_id: "task-bad-1",
        type: "task.execute",
        payload: {
          turn_id: "not-a-uuid",
          dispatch_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
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

  it("emits plan_update event", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
    });
    fixture.setClient(client);

    const received = new Promise<unknown>((resolve) => {
      client.on("plan_update", resolve);
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
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });
    fixture.setClient(client);

    const received = new Promise<unknown>((resolve) => {
      client.on("plan.update", resolve as (data: never) => void);
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
}

function registerEventsAdvancedTests(fixture: EventsFixture): void {
  it("emits additional protocol events by wire event type", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });
    fixture.setClient(client);

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await delay(10);

    const cases = [
      {
        type: "turn.queued",
        payload: {
          turn_id: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
      {
        type: "typing.started",
        payload: {
          conversation_id: "conversation-1",
        },
      },
      {
        type: "message.delta",
        payload: {
          conversation_id: "conversation-1",
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
    ] as const;

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const receivedP = new Promise<unknown>((resolve) => {
        client.on(c.type as never, resolve as (data: never) => void);
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
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });
    fixture.setClient(client);

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
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });
    fixture.setClient(client);

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await delay(10);

    const pending = client.approvalResolve({
      approval_id: "550e8400-e29b-41d4-a716-446655440000",
      decision: "approved",
    });
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
            approval_id: "550e8400-e29b-41d4-a716-446655440000",
            approval_key: "approval-7",
            kind: "workflow_step",
            status: "approved",
            prompt: "ok?",
            motivation: "The tool call required review.",
            created_at: "2026-02-20T00:00:00Z",
            latest_review: {
              review_id: "550e8400-e29b-41d4-a716-446655440001",
              target_type: "approval",
              target_id: "550e8400-e29b-41d4-a716-446655440000",
              reviewer_kind: "human",
              reviewer_id: "operator-1",
              state: "approved",
              reason: "approved",
              risk_level: "low",
              risk_score: 5,
              evidence: null,
              decision_payload: null,
              created_at: "2026-02-20T00:00:01Z",
              started_at: "2026-02-20T00:00:01Z",
              completed_at: "2026-02-20T00:00:01Z",
            },
          },
        },
      }),
    );

    const res = await pending;
    expect(res.approval.approval_id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(res.approval.status).toBe("approved");
  });
}

export function registerEventsTests(fixture: EventsFixture): void {
  registerEventsBasicTests(fixture);
  registerEventsAdvancedTests(fixture);
}
