import { afterEach, describe, expect, it } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { executeWorkboardTool } from "../../src/modules/agent/tool-executor-workboard-tools.js";
import { WorkboardDispatcher } from "../../src/modules/workboard/dispatcher.js";
import { WorkboardReconciler } from "../../src/modules/workboard/reconciler.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import { SessionLaneNodeAttachmentDal } from "../../src/modules/agent/session-lane-node-attachment-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

function createFakeAgents(reply: string): AgentRegistry {
  return {
    getRuntime: async () =>
      ({
        turn: async () => ({ reply }),
      }) as Awaited<ReturnType<AgentRegistry["getRuntime"]>>,
  } as AgentRegistry;
}

describe("WorkBoard regressions", () => {
  let db: SqliteDb | undefined;
  let attachmentDal: SessionLaneNodeAttachmentDal | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
    attachmentDal = undefined;
  });

  it("requeues cancelled orphaned execution tasks back to ready", async () => {
    db = openTestSqliteDb();
    attachmentDal = new SessionLaneNodeAttachmentDal(db);
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const item = await workboard.createItem({
      scope,
      createdFromSessionKey: "agent:default:test:default:channel:thread-regression-1",
      item: { kind: "action", title: "Cancelled orphan recovery", acceptance: { done: true } },
    });
    const task = await workboard.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        status: "queued",
        execution_profile: "executor_rw",
        side_effect_class: "workspace",
      },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.refinement.phase",
      value_json: "complete",
      provenance_json: { source: "test" },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.size.class",
      value_json: "small",
      provenance_json: { source: "test" },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.dispatch.phase",
      value_json: "running",
      provenance_json: { source: "test" },
    });
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "ready" });
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "doing" });
    await workboard.updateTask({
      scope,
      task_id: task.task_id,
      patch: {
        status: "cancelled",
        finished_at: new Date().toISOString(),
        result_summary: "Cancelled while executor disappeared.",
      },
    });

    const reconciler = new WorkboardReconciler({ db });
    await reconciler.tick();

    expect(await workboard.getItem({ scope, work_item_id: item.work_item_id })).toMatchObject({
      status: "ready",
    });
    expect(await workboard.getTask({ scope, task_id: task.task_id })).toMatchObject({
      status: "queued",
    });
    expect(
      await workboard.getStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
        key: "work.dispatch.phase",
      }),
    ).toMatchObject({ value_json: "unassigned" });

    const dispatcher = new WorkboardDispatcher({
      db,
      agents: createFakeAgents("executor retried"),
      sessionLaneNodeAttachmentDal: attachmentDal,
    });
    await dispatcher.tick();

    expect(await workboard.getItem({ scope, work_item_id: item.work_item_id })).toMatchObject({
      status: "done",
    });
  });

  it("returns doing items with no tasks to ready so they can be redispatched", async () => {
    db = openTestSqliteDb();
    attachmentDal = new SessionLaneNodeAttachmentDal(db);
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const item = await workboard.createItem({
      scope,
      createdFromSessionKey: "agent:default:test:default:channel:thread-regression-2",
      item: { kind: "action", title: "Missing task recovery", acceptance: { done: true } },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.refinement.phase",
      value_json: "complete",
      provenance_json: { source: "test" },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.size.class",
      value_json: "small",
      provenance_json: { source: "test" },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.dispatch.phase",
      value_json: "running",
      provenance_json: { source: "test" },
    });
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "ready" });
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "doing" });

    const reconciler = new WorkboardReconciler({ db });
    await reconciler.tick();

    expect(await workboard.getItem({ scope, work_item_id: item.work_item_id })).toMatchObject({
      status: "ready",
    });
    expect(
      await workboard.getStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
        key: "work.dispatch.phase",
      }),
    ).toMatchObject({ value_json: "unassigned" });

    const dispatcher = new WorkboardDispatcher({
      db,
      agents: createFakeAgents("executor recreated"),
      sessionLaneNodeAttachmentDal: attachmentDal,
    });
    await dispatcher.tick();

    expect(await workboard.getItem({ scope, work_item_id: item.work_item_id })).toMatchObject({
      status: "done",
    });
  });

  it("clamps negative priority updates the same way create does", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const workSessionKey = "agent:default:test:default:channel:thread-regression-3";
    const toolContext = {
      workspaceLease: {
        db,
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
      },
    };

    const created = await executeWorkboardTool(
      toolContext,
      "workboard.item.create",
      "tool-create-item",
      { title: "Priority clamp", priority: 3 },
      { work_session_key: workSessionKey },
    );
    const createdPayload = JSON.parse(created?.output ?? "{}") as {
      item?: { work_item_id?: string };
    };
    const workItemId = createdPayload.item?.work_item_id ?? "";

    await executeWorkboardTool(
      toolContext,
      "workboard.item.update",
      "tool-update-item",
      { work_item_id: workItemId, priority: -9 },
      { work_session_key: workSessionKey },
    );

    expect(
      await workboard.getItem({
        scope: {
          tenant_id: DEFAULT_TENANT_ID,
          agent_id: DEFAULT_AGENT_ID,
          workspace_id: DEFAULT_WORKSPACE_ID,
        },
        work_item_id: workItemId,
      }),
    ).toMatchObject({ priority: 0 });
  });
});
