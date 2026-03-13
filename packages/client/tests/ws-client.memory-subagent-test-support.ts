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

type MemorySubagentFixture = {
  getServer: () => TestServer | undefined;
  setServer: (s: TestServer) => void;
  getClient: () => TyrumClient | undefined;
  setClient: (c: TyrumClient) => void;
};

function registerSubagentTests(fixture: MemorySubagentFixture): void {
  it("sends typed subagent.* requests and returns validated results", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });
    fixture.setClient(client);

    const connectedP = new Promise<void>((resolve) => {
      client.on("connected", () => resolve());
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;

    const scopeKeys = { tenant_key: "t-1", agent_key: "agent-1", workspace_key: "default" };
    const scopeIds = {
      tenant_id: "11111111-1111-4111-8111-111111111111",
      agent_id: "22222222-2222-4222-8222-222222222222",
      workspace_id: "33333333-3333-4333-8333-333333333333",
    };
    const workItemId = "11111111-2222-3333-8aaa-555555555555";
    const workItemTaskId = "22222222-3333-4444-8aaa-555555555555";
    const subagentId = "123e4567-e89b-12d3-a456-426614174000";

    const subagent = {
      subagent_id: subagentId,
      ...scopeIds,
      work_item_id: workItemId,
      work_item_task_id: workItemTaskId,
      execution_profile: "subagent",
      session_key: `agent:${scopeKeys.agent_key}:subagent:${subagentId}`,
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
      ...scopeKeys,
      execution_profile: "subagent",
      work_item_id: workItemId,
      work_item_task_id: workItemTaskId,
    };
    const spawnRes = await expectSubagentRequest(
      () => client.subagentSpawn(spawnPayload),
      "subagent.spawn",
      spawnPayload,
      { subagent },
    );
    expect(spawnRes.subagent.subagent_id).toBe(subagentId);

    const listPayload = { ...scopeKeys, statuses: ["running"], limit: 1 };
    const listRes = await expectSubagentRequest(
      () => client.subagentList(listPayload),
      "subagent.list",
      listPayload,
      { subagents: [subagent] },
    );
    expect(listRes.subagents[0].subagent_id).toBe(subagentId);

    const getPayload = { ...scopeKeys, subagent_id: subagentId };
    const getRes = await expectSubagentRequest(
      () => client.subagentGet(getPayload),
      "subagent.get",
      getPayload,
      { subagent },
    );
    expect(getRes.subagent.subagent_id).toBe(subagentId);

    const sendPayload = { ...scopeKeys, subagent_id: subagentId, content: "hello" };
    const sendRes = await expectSubagentRequest(
      () => client.subagentSend(sendPayload),
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
    const closePayload = { ...scopeKeys, subagent_id: subagentId, reason: "done" };
    const closeRes = await expectSubagentRequest(
      () => client.subagentClose(closePayload),
      "subagent.close",
      closePayload,
      { subagent: closeSubagent },
    );
    expect(closeRes.subagent.status).toBe("closed");
  });

  it("rejects invalid subagent.* payloads without sending", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });
    fixture.setClient(client);

    const connectedP = new Promise<void>((resolve) => {
      client.on("connected", () => resolve());
    });

    client.connect();
    const ws = await server.waitForClient();
    await acceptConnect(ws);
    await connectedP;

    const outbound: unknown[] = [];
    ws.on("message", (data) => {
      outbound.push(JSON.parse(data.toString()));
    });

    const scope = { tenant_key: "t-1", agent_key: "agent-1", workspace_key: "default" };
    const invalidPayload = {
      ...scope,
      subagent_id: "123e4567-e89b-12d3-a456-426614174000",
      content: "   ",
    };

    await expect(
      withTimeout(client.subagentSend(invalidPayload as any), 200, "subagent.send invalid payload"),
    ).rejects.toThrow(/invalid payload/i);

    await delay(25);
    expect(outbound).toEqual([]);
  });

  it("emits subagent.* events", async () => {
    const server = createTestServer();
    fixture.setServer(server);
    const client = new TyrumClient({
      url: server.url,
      token: "t",
      capabilities: [],
      reconnect: false,
    });
    fixture.setClient(client);

    const connectedP = new Promise<void>((resolve) => {
      client.on("connected", () => resolve());
    });

    const scope = {
      tenant_id: "11111111-1111-4111-8111-111111111111",
      agent_id: "22222222-2222-4222-8222-222222222222",
      workspace_id: "33333333-3333-4333-8333-333333333333",
    };
    const workItemId = "11111111-2222-3333-8aaa-555555555555";
    const workItemTaskId = "22222222-3333-4444-8aaa-555555555555";
    const subagentId = "123e4567-e89b-12d3-a456-426614174000";
    const subagent = {
      subagent_id: subagentId,
      ...scope,
      work_item_id: workItemId,
      work_item_task_id: workItemTaskId,
      execution_profile: "subagent",
      session_key: `agent:agent-1:subagent:${subagentId}`,
      lane: "subagent",
      status: "running",
      created_at: "2026-02-19T12:00:00Z",
      last_heartbeat_at: null,
    };

    const spawnedReceivedP = new Promise<unknown>((resolve) => {
      client.on("subagent.spawned", resolve);
    });
    const outputReceivedP = new Promise<unknown>((resolve) => {
      client.on("subagent.output", resolve);
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
}

export function registerMemorySubagentTests(fixture: MemorySubagentFixture): void {
  registerSubagentTests(fixture);
}
