import { expect, it } from "vitest";
import { TyrumClient } from "../src/ws-client.js";
import {
  type TestServer,
  createTestServer,
  waitForMessage,
  acceptConnect,
} from "./ws-client.test-support.js";

type WorkFixture = {
  getServer: () => TestServer | undefined;
  setServer: (s: TestServer) => void;
  getClient: () => TyrumClient | undefined;
  setClient: (c: TyrumClient) => void;
};

function registerWorkItemTests(fixture: WorkFixture): void {
  it("sends typed work.* requests and returns validated results", async () => {
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

    const workItem = {
      work_item_id: "123e4567-e89b-12d3-a456-426614174000",
      ...scopeIds,
      kind: "action",
      title: "Test item",
      status: "backlog",
      priority: 0,
      created_at: "2026-02-19T12:00:00Z",
      created_from_session_key: `agent:${scopeKeys.agent_key}:main`,
      last_active_at: null,
      fingerprint: { resources: ["repo:example/repo"] },
      acceptance: { checks: [] },
      budgets: null,
      parent_work_item_id: null,
    };

    const workArtifact = {
      artifact_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      ...scopeIds,
      work_item_id: workItem.work_item_id,
      kind: "candidate_plan",
      title: "Plan",
      body_md: "- step 1",
      refs: [],
      created_at: "2026-02-19T12:00:00Z",
    };

    const decision = {
      decision_id: "550e8400-e29b-41d4-a716-446655440000",
      ...scopeIds,
      work_item_id: workItem.work_item_id,
      question: "Q?",
      chosen: "A",
      alternatives: ["B"],
      rationale_md: "Because",
      input_artifact_ids: [workArtifact.artifact_id],
      created_at: "2026-02-19T12:00:00Z",
    };

    const _signal = {
      signal_id: "11111111-2222-3333-8aaa-555555555555",
      ...scopeIds,
      work_item_id: workItem.work_item_id,
      trigger_kind: "time",
      trigger_spec_json: { at: "tomorrow" },
      payload_json: { note: "ping" },
      status: "active",
      created_at: "2026-02-19T12:00:00Z",
      last_fired_at: null,
    };

    const _stateKvEntry = {
      ...scopeIds,
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

    const listPayload = { ...scopeKeys, limit: 1 };
    const listRes = await expectWorkRequest(
      () => client.workList(listPayload),
      "work.list",
      listPayload,
      { items: [workItem], next_cursor: "cursor-1" },
    );
    expect(listRes.items[0].work_item_id).toBe(workItem.work_item_id);

    const getPayload = { ...scopeKeys, work_item_id: workItem.work_item_id };
    const getRes = await expectWorkRequest(
      () => client.workGet(getPayload),
      "work.get",
      getPayload,
      {
        item: workItem,
      },
    );
    expect(getRes.item.work_item_id).toBe(workItem.work_item_id);

    const createPayload = { ...scopeKeys, item: { kind: "action", title: "Test item" } };
    const createRes = await expectWorkRequest(
      () => client.workCreate(createPayload),
      "work.create",
      createPayload,
      { item: workItem },
    );
    expect(createRes.item.work_item_id).toBe(workItem.work_item_id);

    const updatePayload = {
      ...scopeKeys,
      work_item_id: workItem.work_item_id,
      patch: { title: "Updated" },
    };
    const updateRes = await expectWorkRequest(
      () => client.workUpdate(updatePayload),
      "work.update",
      updatePayload,
      { item: workItem },
    );
    expect(updateRes.item.work_item_id).toBe(workItem.work_item_id);

    const transitionPayload = {
      ...scopeKeys,
      work_item_id: workItem.work_item_id,
      status: "doing",
    };
    const transitionRes = await expectWorkRequest(
      () => client.workTransition(transitionPayload),
      "work.transition",
      transitionPayload,
      { item: workItem },
    );
    expect(transitionRes.item.work_item_id).toBe(workItem.work_item_id);

    const artifactListPayload = { ...scopeKeys, work_item_id: workItem.work_item_id };
    const artifactListRes = await expectWorkRequest(
      () => client.workArtifactList(artifactListPayload),
      "work.artifact.list",
      artifactListPayload,
      { artifacts: [workArtifact], next_cursor: "cursor-2" },
    );
    expect(artifactListRes.artifacts[0].artifact_id).toBe(workArtifact.artifact_id);

    const artifactGetPayload = { ...scopeKeys, artifact_id: workArtifact.artifact_id };
    const artifactGetRes = await expectWorkRequest(
      () => client.workArtifactGet(artifactGetPayload),
      "work.artifact.get",
      artifactGetPayload,
      { artifact: workArtifact },
    );
    expect(artifactGetRes.artifact.artifact_id).toBe(workArtifact.artifact_id);

    const artifactCreatePayload = {
      ...scopeKeys,
      artifact: { kind: "candidate_plan", title: "Plan" },
    };
    const artifactCreateRes = await expectWorkRequest(
      () => client.workArtifactCreate(artifactCreatePayload),
      "work.artifact.create",
      artifactCreatePayload,
      { artifact: workArtifact },
    );
    expect(artifactCreateRes.artifact.artifact_id).toBe(workArtifact.artifact_id);

    const decisionListPayload = { ...scopeKeys, work_item_id: workItem.work_item_id };
    const decisionListRes = await expectWorkRequest(
      () => client.workDecisionList(decisionListPayload),
      "work.decision.list",
      decisionListPayload,
      { decisions: [decision], next_cursor: "cursor-3" },
    );
    expect(decisionListRes.decisions[0].decision_id).toBe(decision.decision_id);

    const decisionGetPayload = { ...scopeKeys, decision_id: decision.decision_id };
    const decisionGetRes = await expectWorkRequest(
      () => client.workDecisionGet(decisionGetPayload),
      "work.decision.get",
      decisionGetPayload,
      { decision },
    );
    expect(decisionGetRes.decision.decision_id).toBe(decision.decision_id);

    const decisionCreatePayload = {
      ...scopeKeys,
      decision: { question: "Q?", chosen: "A", rationale_md: "Because" },
    };
    const decisionCreateRes = await expectWorkRequest(
      () => client.workDecisionCreate(decisionCreatePayload),
      "work.decision.create",
      decisionCreatePayload,
      { decision },
    );
    expect(decisionCreateRes.decision.decision_id).toBe(decision.decision_id);
  });
}

function registerWorkSignalKvTests(fixture: WorkFixture): void {
  it("sends typed work.signal.* and work.state_kv.* requests", async () => {
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

    const workItemId = "123e4567-e89b-12d3-a456-426614174000";

    const signal = {
      signal_id: "11111111-2222-3333-8aaa-555555555555",
      ...scopeIds,
      work_item_id: workItemId,
      trigger_kind: "time",
      trigger_spec_json: { at: "tomorrow" },
      payload_json: { note: "ping" },
      status: "active",
      created_at: "2026-02-19T12:00:00Z",
      last_fired_at: null,
    };

    const stateKvEntry = {
      ...scopeIds,
      work_item_id: workItemId,
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

    const signalListPayload = { ...scopeKeys, work_item_id: workItemId };
    const signalListRes = await expectWorkRequest(
      () => client.workSignalList(signalListPayload),
      "work.signal.list",
      signalListPayload,
      { signals: [signal], next_cursor: "cursor-4" },
    );
    expect(signalListRes.signals[0].signal_id).toBe(signal.signal_id);

    const signalGetPayload = { ...scopeKeys, signal_id: signal.signal_id };
    const signalGetRes = await expectWorkRequest(
      () => client.workSignalGet(signalGetPayload),
      "work.signal.get",
      signalGetPayload,
      { signal },
    );
    expect(signalGetRes.signal.signal_id).toBe(signal.signal_id);

    const signalCreatePayload = {
      ...scopeKeys,
      signal: { trigger_kind: "time", trigger_spec_json: { at: "tomorrow" } },
    };
    const signalCreateRes = await expectWorkRequest(
      () => client.workSignalCreate(signalCreatePayload),
      "work.signal.create",
      signalCreatePayload,
      { signal },
    );
    expect(signalCreateRes.signal.signal_id).toBe(signal.signal_id);

    const signalUpdatePayload = { ...scopeKeys, signal_id: signal.signal_id, patch: {} };
    const signalUpdateRes = await expectWorkRequest(
      () => client.workSignalUpdate(signalUpdatePayload),
      "work.signal.update",
      signalUpdatePayload,
      { signal },
    );
    expect(signalUpdateRes.signal.signal_id).toBe(signal.signal_id);

    const kvGetPayload = { scope: { ...scopeKeys, kind: "agent" }, key: "prefs.timezone" };
    const kvGetRes = await expectWorkRequest(
      () => client.workStateKvGet(kvGetPayload),
      "work.state_kv.get",
      kvGetPayload,
      { entry: null },
    );
    expect(kvGetRes.entry).toBeNull();

    const kvListPayload = {
      scope: { ...scopeKeys, kind: "work_item", work_item_id: workItemId },
    };
    const kvListRes = await expectWorkRequest(
      () => client.workStateKvList(kvListPayload),
      "work.state_kv.list",
      kvListPayload,
      { entries: [] },
    );
    expect(kvListRes.entries).toEqual([]);

    const kvSetPayload = {
      scope: { ...scopeKeys, kind: "work_item", work_item_id: workItemId },
      key: "branch",
      value_json: { name: "main" },
    };
    const kvSetRes = await expectWorkRequest(
      () => client.workStateKvSet(kvSetPayload),
      "work.state_kv.set",
      kvSetPayload,
      { entry: stateKvEntry },
    );
    expect(kvSetRes.entry.key).toBe("branch");
  });
}

export function registerWorkTests(fixture: WorkFixture): void {
  registerWorkItemTests(fixture);
  registerWorkSignalKvTests(fixture);
}
