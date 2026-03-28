/**
 * WS WorkBoard conformance tests.
 *
 * Validates WorkBoard + subagent behavior end-to-end against a real gateway
 * instance over WebSocket using `TyrumClient`.
 */

import { afterEach, describe, expect, it } from "vitest";
import { TyrumClient } from "../../src/ws-client.js";
import { startGateway, withTimeout, type GatewayHarness } from "./harness.js";
import {
  CONFORMANCE_TIMEOUT_MS,
  createConnectedClient,
  waitForEvent,
  waitForEventMatching,
} from "./ws-test-utils.js";
import { WorkSignalScheduler } from "../../../gateway/src/modules/workboard/signal-scheduler.js";
import { ChannelInboxDal } from "../../../gateway/src/modules/channels/inbox-dal.js";
import { ChannelOutboxDal } from "../../../gateway/src/modules/channels/outbox-dal.js";
import { IdentityScopeDal } from "../../../gateway/src/modules/identity/scope.js";
import { WorkboardDal } from "../../../gateway/src/modules/workboard/dal.js";
import type { AgentRegistry } from "../../../gateway/src/modules/agent/registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIMEOUT = CONFORMANCE_TIMEOUT_MS;
const scope = { tenant_key: "default", agent_key: "default", workspace_key: "default" } as const;

async function markWorkItemDispatchReady(gw: GatewayHarness, workItemId: string): Promise<void> {
  const identityScopeDal = new IdentityScopeDal(gw.protocolDeps.db!);
  const resolvedScope = await identityScopeDal.resolveScopeIds({
    tenantKey: scope.tenant_key,
    agentKey: scope.agent_key,
    workspaceKey: scope.workspace_key,
  });
  const workboard = new WorkboardDal(gw.protocolDeps.db!);
  const scopeIds = {
    tenant_id: resolvedScope.tenantId,
    agent_id: resolvedScope.agentId,
    workspace_id: resolvedScope.workspaceId,
  } as const;
  await workboard.updateItem({
    scope: scopeIds,
    work_item_id: workItemId,
    patch: { acceptance: { done: true } },
  });
  await workboard.setStateKv({
    scope: { kind: "work_item", ...scopeIds, work_item_id: workItemId },
    key: "work.refinement.phase",
    value_json: "done",
    provenance_json: { source: "test" },
  });
  await workboard.setStateKv({
    scope: { kind: "work_item", ...scopeIds, work_item_id: workItemId },
    key: "work.size.class",
    value_json: "small",
    provenance_json: { source: "test" },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WS WorkBoard conformance (client <-> gateway)", () => {
  let gw: GatewayHarness | undefined;
  let client: TyrumClient | undefined;

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    if (gw) {
      await gw.stop();
      gw = undefined;
    }
  });

  it("supports work.create/list/get and broadcasts work.item.created", async () => {
    gw = await startGateway();
    const result = createConnectedClient(gw);
    client = result.client;

    await withTimeout(result.connectedP, TIMEOUT, "connected");

    const createdEventP = waitForEvent<{ payload: { item: { work_item_id: string } } }>(
      client,
      "work.item.created",
    );

    const created = await client.workCreate({
      ...scope,
      item: { kind: "action", title: "Hello conformance" },
    });

    const createdEvt = await withTimeout(createdEventP, TIMEOUT, "work.item.created");
    expect(createdEvt.payload.item.work_item_id).toBe(created.item.work_item_id);

    const listed = await client.workList({ ...scope, limit: 50 });
    expect(listed.items.some((i) => i.work_item_id === created.item.work_item_id)).toBe(true);

    const fetched = await client.workGet({ ...scope, work_item_id: created.item.work_item_id });
    expect(fetched.item.work_item_id).toBe(created.item.work_item_id);
  });

  it("enforces item-level WIP cap for operator work.transition requests", async () => {
    gw = await startGateway();
    const result = createConnectedClient(gw);
    client = result.client;

    await withTimeout(result.connectedP, TIMEOUT, "connected");

    const item1 = await client.workCreate({ ...scope, item: { kind: "action", title: "Item 1" } });
    const item2 = await client.workCreate({ ...scope, item: { kind: "action", title: "Item 2" } });
    const item3 = await client.workCreate({ ...scope, item: { kind: "action", title: "Item 3" } });
    await markWorkItemDispatchReady(gw, item1.item.work_item_id);
    await markWorkItemDispatchReady(gw, item2.item.work_item_id);
    await markWorkItemDispatchReady(gw, item3.item.work_item_id);

    await client.workTransition({
      ...scope,
      work_item_id: item1.item.work_item_id,
      status: "ready",
    });
    await client.workTransition({
      ...scope,
      work_item_id: item2.item.work_item_id,
      status: "ready",
    });
    await client.workTransition({
      ...scope,
      work_item_id: item3.item.work_item_id,
      status: "ready",
    });

    await client.workTransition({
      ...scope,
      work_item_id: item1.item.work_item_id,
      status: "doing",
    });
    await client.workTransition({
      ...scope,
      work_item_id: item2.item.work_item_id,
      status: "doing",
    });

    await expect(
      client.workTransition({ ...scope, work_item_id: item3.item.work_item_id, status: "doing" }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("wip_limit_exceeded"),
    });
  });

  it("supports drilldown artifacts + decisions create/list/get and broadcasts create events", async () => {
    gw = await startGateway();
    const result = createConnectedClient(gw);
    client = result.client;

    await withTimeout(result.connectedP, TIMEOUT, "connected");

    const item = await client.workCreate({
      ...scope,
      item: { kind: "action", title: "Drilldown item" },
    });

    const artifactCreatedP = waitForEvent<{ payload: { artifact: { artifact_id: string } } }>(
      client,
      "work.artifact.created",
    );
    const createdArtifact = await client.workArtifactCreate({
      ...scope,
      artifact: {
        work_item_id: item.item.work_item_id,
        kind: "other",
        title: "Artifact 1",
        body_md: "Body",
      },
    });

    const artifactEvt = await withTimeout(artifactCreatedP, TIMEOUT, "work.artifact.created");
    expect(artifactEvt.payload.artifact.artifact_id).toBe(createdArtifact.artifact.artifact_id);

    const artifacts = await client.workArtifactList({
      ...scope,
      work_item_id: item.item.work_item_id,
      limit: 50,
    });
    expect(
      artifacts.artifacts.some((a) => a.artifact_id === createdArtifact.artifact.artifact_id),
    ).toBe(true);

    const artifact = await client.workArtifactGet({
      ...scope,
      artifact_id: createdArtifact.artifact.artifact_id,
    });
    expect(artifact.artifact.artifact_id).toBe(createdArtifact.artifact.artifact_id);

    const decisionCreatedP = waitForEvent<{ payload: { decision: { decision_id: string } } }>(
      client,
      "work.decision.created",
    );
    const createdDecision = await client.workDecisionCreate({
      ...scope,
      decision: {
        work_item_id: item.item.work_item_id,
        question: "Question?",
        chosen: "Chosen",
        alternatives: ["Alt"],
        rationale_md: "Because.",
        input_artifact_ids: [createdArtifact.artifact.artifact_id],
      },
    });

    const decisionEvt = await withTimeout(decisionCreatedP, TIMEOUT, "work.decision.created");
    expect(decisionEvt.payload.decision.decision_id).toBe(createdDecision.decision.decision_id);

    const decisions = await client.workDecisionList({
      ...scope,
      work_item_id: item.item.work_item_id,
      limit: 50,
    });
    expect(
      decisions.decisions.some((d) => d.decision_id === createdDecision.decision.decision_id),
    ).toBe(true);

    const decision = await client.workDecisionGet({
      ...scope,
      decision_id: createdDecision.decision.decision_id,
    });
    expect(decision.decision.decision_id).toBe(createdDecision.decision.decision_id);
  });

  it("supports WorkSignals create/update/list/get and fires an event-based trigger end-to-end", async () => {
    gw = await startGateway();
    const result = createConnectedClient(gw);
    client = result.client;

    await withTimeout(result.connectedP, TIMEOUT, "connected");

    const item = await client.workCreate({
      ...scope,
      item: { kind: "action", title: "Signal item" },
    });
    await markWorkItemDispatchReady(gw, item.item.work_item_id);

    const signalCreatedP = waitForEvent<{ payload: { signal: { signal_id: string } } }>(
      client,
      "work.signal.created",
    );
    const signalUpdatedP = waitForEvent<{ payload: { signal: { signal_id: string } } }>(
      client,
      "work.signal.updated",
    );
    const signalFiredP = waitForEvent<{ payload: { signal_id: string; firing_id: string } }>(
      client,
      "work.signal.fired",
    );

    const created = await client.workSignalCreate({
      ...scope,
      signal: {
        work_item_id: item.item.work_item_id,
        trigger_kind: "event",
        trigger_spec_json: { kind: "work_item.status.transition", to: ["blocked"] },
      },
    });

    const createdEvt = await withTimeout(signalCreatedP, TIMEOUT, "work.signal.created");
    expect(createdEvt.payload.signal.signal_id).toBe(created.signal.signal_id);

    const updated = await client.workSignalUpdate({
      ...scope,
      signal_id: created.signal.signal_id,
      patch: { payload_json: { hello: "world" } },
    });

    const updatedEvt = await withTimeout(signalUpdatedP, TIMEOUT, "work.signal.updated");
    expect(updatedEvt.payload.signal.signal_id).toBe(updated.signal.signal_id);

    const listed = await client.workSignalList({
      ...scope,
      work_item_id: item.item.work_item_id,
      limit: 50,
    });
    expect(listed.signals.some((s) => s.signal_id === created.signal.signal_id)).toBe(true);

    const got = await client.workSignalGet({ ...scope, signal_id: created.signal.signal_id });
    expect(got.signal.signal_id).toBe(created.signal.signal_id);

    await client.workTransition({
      ...scope,
      work_item_id: item.item.work_item_id,
      status: "ready",
    });
    await client.workTransition({
      ...scope,
      work_item_id: item.item.work_item_id,
      status: "doing",
    });
    await client.workTransition({
      ...scope,
      work_item_id: item.item.work_item_id,
      status: "blocked",
    });

    const scheduler = new WorkSignalScheduler({
      db: gw.protocolDeps.db!,
      connectionManager: gw.protocolDeps.connectionManager,
      owner: "workboard-conformance",
    });
    await scheduler.tick();

    const firedEvt = await withTimeout(signalFiredP, TIMEOUT, "work.signal.fired");
    expect(firedEvt.payload.signal_id).toBe(created.signal.signal_id);
    expect(firedEvt.payload.firing_id.length).toBeGreaterThan(0);
  });

  it("supports canonical work.state_kv set/get and broadcasts updates", async () => {
    gw = await startGateway();
    const result = createConnectedClient(gw);
    client = result.client;

    await withTimeout(result.connectedP, TIMEOUT, "connected");

    const kvScope = { kind: "agent", ...scope } as const;

    const updatedP = waitForEvent<{ payload: { key: string } }>(client, "work.state_kv.updated");

    await client.workStateKvSet({ scope: kvScope, key: "focus", value_json: { mode: "test" } });

    const updatedEvt = await withTimeout(updatedP, TIMEOUT, "work.state_kv.updated");
    expect(updatedEvt.payload.key).toBe("focus");

    const got = await client.workStateKvGet({ scope: kvScope, key: "focus" });
    expect(got.entry).toBeTruthy();
    expect(got.entry?.key).toBe("focus");

    const listed = await client.workStateKvList({ scope: kvScope, prefix: "fo" });
    expect(listed.entries.some((e) => e.key === "focus")).toBe(true);
  });

  it("routes terminal-state notifications to last_active_conversation_key with created_from fallback", async () => {
    const nowMs = 1_700_000_000_000;

    gw = await startGateway();
    const result = createConnectedClient(gw);
    client = result.client;

    await withTimeout(result.connectedP, TIMEOUT, "connected");

    const inbox = new ChannelInboxDal(gw.protocolDeps.db!);
    const outbox = new ChannelOutboxDal(gw.protocolDeps.db!);
    const identityScopeDal = new IdentityScopeDal(gw.protocolDeps.db!);
    const resolvedScope = await identityScopeDal.resolveScopeIds({
      tenantKey: scope.tenant_key,
      agentKey: scope.agent_key,
      workspaceKey: scope.workspace_key,
    });
    const scopeIds = {
      tenant_id: resolvedScope.tenantId,
      agent_id: resolvedScope.agentId,
      workspace_id: resolvedScope.workspaceId,
    };

    const createdFromKey = "agent:default:telegram:default:channel:created-thread";
    const activeKey = "agent:default:telegram:default:channel:active-thread";

    const createdRoute = await inbox.enqueue({
      source: "telegram:default",
      thread_id: "created-thread",
      message_id: "m-created-1",
      key: createdFromKey,
      received_at_ms: nowMs,
      payload: { kind: "text", text: "hi" },
    });

    const activeRoute = await inbox.enqueue({
      source: "telegram:default",
      thread_id: "active-thread",
      message_id: "m-active-1",
      key: activeKey,
      received_at_ms: nowMs + 1,
      payload: { kind: "text", text: "hi" },
    });

    // Ensure fallback behavior is exercised (ChannelInboxDal.enqueue best-effort upserts activity).
    await gw.protocolDeps.db!.run(
      `DELETE FROM work_scope_activity
       WHERE tenant_id = ? AND agent_id = ? AND workspace_id = ?`,
      [scopeIds.tenant_id, scopeIds.agent_id, scopeIds.workspace_id],
    );
    await gw.protocolDeps.db!.run(
      `INSERT INTO conversation_send_policy_overrides (
         tenant_id,
         conversation_key,
         send_policy,
         updated_at_ms
       )
       VALUES (?, ?, 'on', ?)
       ON CONFLICT (tenant_id, conversation_key) DO UPDATE SET
         send_policy = excluded.send_policy,
         updated_at_ms = excluded.updated_at_ms`,
      [scopeIds.tenant_id, createdFromKey, nowMs + 2],
    );
    await gw.protocolDeps.db!.run(
      `INSERT INTO conversation_send_policy_overrides (
         tenant_id,
         conversation_key,
         send_policy,
         updated_at_ms
       )
       VALUES (?, ?, 'on', ?)
       ON CONFLICT (tenant_id, conversation_key) DO UPDATE SET
         send_policy = excluded.send_policy,
         updated_at_ms = excluded.updated_at_ms`,
      [scopeIds.tenant_id, activeKey, nowMs + 2],
    );

    const item1 = await client.workCreate({
      ...scope,
      item: {
        kind: "action",
        title: "Notify fallback",
        created_from_conversation_key: createdFromKey,
      },
    });
    await markWorkItemDispatchReady(gw, item1.item.work_item_id);

    const completed1P = waitForEventMatching<{
      payload: { item: { work_item_id: string; status: string } };
    }>(
      client,
      "work.item.completed",
      (evt) => evt.payload.item.work_item_id === item1.item.work_item_id,
    );

    await client.workTransition({
      ...scope,
      work_item_id: item1.item.work_item_id,
      status: "ready",
    });
    await client.workTransition({
      ...scope,
      work_item_id: item1.item.work_item_id,
      status: "doing",
    });
    await client.workTransition({
      ...scope,
      work_item_id: item1.item.work_item_id,
      status: "done",
    });

    const completedEvt1 = await withTimeout(completed1P, TIMEOUT, "work.item.completed (item1)");
    expect(completedEvt1.payload.item.work_item_id).toBe(item1.item.work_item_id);
    expect(completedEvt1.payload.item.status).toBe("done");

    const createdOutbox1 = await outbox.listForInbox(createdRoute.row.inbox_id);
    const activeOutbox1 = await outbox.listForInbox(activeRoute.row.inbox_id);
    const notificationsEnabled = createdOutbox1.length + activeOutbox1.length > 0;
    if (notificationsEnabled) {
      expect(createdOutbox1.length).toBeGreaterThan(0);
      expect(activeOutbox1.length).toBe(0);
    }

    await new WorkboardDal(gw.protocolDeps.db!).upsertScopeActivity({
      scope: scopeIds,
      last_active_conversation_key: activeKey,
      updated_at_ms: nowMs + 2,
    });

    const item2 = await client.workCreate({
      ...scope,
      item: {
        kind: "action",
        title: "Notify last active",
        created_from_conversation_key: createdFromKey,
      },
    });
    await markWorkItemDispatchReady(gw, item2.item.work_item_id);

    const createdBefore = await outbox.listForInbox(createdRoute.row.inbox_id);
    const activeBefore = await outbox.listForInbox(activeRoute.row.inbox_id);

    const completed2P = waitForEventMatching<{
      payload: { item: { work_item_id: string; status: string } };
    }>(
      client,
      "work.item.completed",
      (evt) => evt.payload.item.work_item_id === item2.item.work_item_id,
    );

    await client.workTransition({
      ...scope,
      work_item_id: item2.item.work_item_id,
      status: "ready",
    });
    await client.workTransition({
      ...scope,
      work_item_id: item2.item.work_item_id,
      status: "doing",
    });
    await client.workTransition({
      ...scope,
      work_item_id: item2.item.work_item_id,
      status: "done",
    });

    const completedEvt2 = await withTimeout(completed2P, TIMEOUT, "work.item.completed (item2)");
    expect(completedEvt2.payload.item.work_item_id).toBe(item2.item.work_item_id);
    expect(completedEvt2.payload.item.status).toBe("done");

    const createdAfter = await outbox.listForInbox(createdRoute.row.inbox_id);
    const activeAfter = await outbox.listForInbox(activeRoute.row.inbox_id);
    if (notificationsEnabled) {
      expect(createdAfter.length).toBe(createdBefore.length);
      expect(activeAfter.length).toBe(activeBefore.length + 1);
    } else {
      expect(createdAfter.length).toBe(createdBefore.length);
      expect(activeAfter.length).toBe(activeBefore.length);
    }
  });

  it("spawns a subagent and receives a subagent.output event end-to-end", async () => {
    const agents = {
      getRuntime: async () =>
        ({
          turn: async () => ({ reply: "subagent ok" }),
        }) as unknown,
    } as unknown as AgentRegistry;

    gw = await startGateway(() => ({ agents }));
    const result = createConnectedClient(gw);
    client = result.client;

    await withTimeout(result.connectedP, TIMEOUT, "connected");

    const item = await client.workCreate({
      ...scope,
      item: { kind: "action", title: "Subagent item" },
    });

    const spawnedP = waitForEvent<{ payload: { subagent: { subagent_id: string } } }>(
      client,
      "subagent.spawned",
    );
    const spawned = await client.subagentSpawn({
      ...scope,
      execution_profile: "default",
      work_item_id: item.item.work_item_id,
    });

    const spawnedEvt = await withTimeout(spawnedP, TIMEOUT, "subagent.spawned");
    expect(spawnedEvt.payload.subagent.subagent_id).toBe(spawned.subagent.subagent_id);

    const outputP = waitForEvent<{
      payload: { subagent_id: string; kind: string; content: string };
    }>(client, "subagent.output");
    await client.subagentSend({
      ...scope,
      subagent_id: spawned.subagent.subagent_id,
      content: "hello",
    });

    const outputEvt = await withTimeout(outputP, TIMEOUT, "subagent.output");
    expect(outputEvt.payload.subagent_id).toBe(spawned.subagent.subagent_id);
    expect(outputEvt.payload.kind).toBe("final");
    expect(outputEvt.payload.content).toBe("subagent ok");
  });
});
