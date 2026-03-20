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

async function waitForMatch<T>(
  load: () => Promise<T>,
  predicate: (value: T) => boolean,
  attempts = 50,
): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await load();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return await load();
}

describe("WorkBoard regressions", () => {
  let db: SqliteDb | undefined;
  let attachmentDal: SessionLaneNodeAttachmentDal | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
    attachmentDal = undefined;
  });

  it("blocks doing items with only cancelled execution tasks without resurrecting them", async () => {
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
      value_json: "done",
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

    expect(
      await waitForMatch(
        async () => await workboard.getItem({ scope, work_item_id: item.work_item_id }),
        (value) => value?.status === "blocked",
      ),
    ).toMatchObject({ status: "blocked" });
    expect(await workboard.getTask({ scope, task_id: task.task_id })).toMatchObject({
      status: "cancelled",
    });
    expect(
      await workboard.getStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
        key: "work.dispatch.phase",
      }),
    ).toMatchObject({ value_json: "blocked" });
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
      value_json: "done",
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

    expect(
      await waitForMatch(
        async () => await workboard.getItem({ scope, work_item_id: item.work_item_id }),
        (value) => value?.status === "ready",
      ),
    ).toMatchObject({ status: "ready" });
    expect(
      await workboard.getStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
        key: "work.dispatch.phase",
      }),
    ).toMatchObject({ value_json: "unassigned" });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.size.class",
      value_json: "small",
      provenance_json: { source: "test" },
    });

    const dispatcher = new WorkboardDispatcher({
      db,
      agents: createFakeAgents("executor recreated"),
      sessionLaneNodeAttachmentDal: attachmentDal,
    });
    await dispatcher.tick();

    expect(
      await waitForMatch(
        async () => await workboard.getItem({ scope, work_item_id: item.work_item_id }),
        (value) => value?.status === "done",
      ),
    ).toMatchObject({ status: "done" });
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

  it("does not restart refinement when answering an already handled clarification", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const mainSessionKey = "agent:default:test:default:channel:thread-regression-4";
    const plannerSessionKey = "agent:default:subagent:423e4567-e89b-12d3-a456-426614174111";
    const item = await workboard.createItem({
      scope,
      createdFromSessionKey: mainSessionKey,
      item: { kind: "action", title: "Clarification idempotency" },
    });
    await workboard.upsertScopeActivity({
      scope,
      last_active_session_key: mainSessionKey,
    });
    await workboard.createSubagent({
      scope,
      subagent: {
        work_item_id: item.work_item_id,
        execution_profile: "planner",
        session_key: plannerSessionKey,
        lane: "subagent",
        status: "running",
      },
      subagentId: "423e4567-e89b-12d3-a456-426614174111",
    });
    const pausedPlannerTask = await workboard.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        status: "paused",
        execution_profile: "planner",
        side_effect_class: "workspace",
      },
    });
    const toolContext = {
      workspaceLease: {
        db,
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
      },
    };

    const requested = await executeWorkboardTool(
      toolContext,
      "workboard.clarification.request",
      "tool-clarification-request",
      { work_item_id: item.work_item_id, question: "Need exact schema?" },
      { work_session_key: plannerSessionKey },
    );
    const requestPayload = JSON.parse(requested?.output ?? "{}") as {
      clarification?: { clarification_id?: string };
    };
    const clarificationId = requestPayload.clarification?.clarification_id ?? "";

    await executeWorkboardTool(
      toolContext,
      "workboard.clarification.answer",
      "tool-clarification-answer-1",
      { clarification_id: clarificationId, answer_text: "Use the shipped schema." },
      { work_session_key: mainSessionKey },
    );

    await workboard.updateTask({
      scope,
      task_id: pausedPlannerTask.task_id,
      patch: {
        status: "completed",
        finished_at: new Date().toISOString(),
      },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.refinement.phase",
      value_json: "done",
      provenance_json: { source: "test" },
    });

    await executeWorkboardTool(
      toolContext,
      "workboard.clarification.answer",
      "tool-clarification-answer-2",
      { clarification_id: clarificationId, answer_text: "Repeat answer should be ignored." },
      { work_session_key: mainSessionKey },
    );

    const plannerTasks = await workboard.listTasks({
      scope,
      work_item_id: item.work_item_id,
    });
    expect(plannerTasks).toHaveLength(1);
    expect(plannerTasks[0]).toMatchObject({ status: "completed" });
    expect(
      await workboard.getStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
        key: "work.refinement.phase",
      }),
    ).toMatchObject({ value_json: "done" });
  });
});
