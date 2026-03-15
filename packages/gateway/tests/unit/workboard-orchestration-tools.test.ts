import { afterEach, describe, expect, it } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { executeWorkboardTool } from "../../src/modules/agent/tool-executor-workboard-tools.js";
import { getExecutionProfile } from "../../src/modules/agent/execution-profiles.js";
import { isToolAllowedWithDenylist } from "../../src/modules/agent/tools.js";
import { WorkboardDispatcher } from "../../src/modules/workboard/dispatcher.js";
import { WorkboardOrchestrator } from "../../src/modules/workboard/orchestrator.js";
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

describe("WorkBoard tools and orchestration", () => {
  let db: SqliteDb | undefined;
  let attachmentDal: SessionLaneNodeAttachmentDal | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
    attachmentDal = undefined;
  });

  it("requests clarification through WorkBoard and sends a steer signal", async () => {
    db = openTestSqliteDb();
    attachmentDal = new SessionLaneNodeAttachmentDal(db);
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const mainSessionKey = "agent:default:test:default:channel:thread-1";
    const item = await workboard.createItem({
      scope,
      createdFromSessionKey: mainSessionKey,
      item: { kind: "action", title: "Clarification test" },
    });
    await workboard.upsertScopeActivity({
      scope,
      last_active_session_key: mainSessionKey,
    });
    const subagent = await workboard.createSubagent({
      scope,
      subagent: {
        work_item_id: item.work_item_id,
        execution_profile: "planner",
        session_key: "agent:default:subagent:123e4567-e89b-12d3-a456-426614174111",
        lane: "subagent",
        status: "running",
      },
      subagentId: "123e4567-e89b-12d3-a456-426614174111",
    });
    await workboard.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        status: "paused",
        execution_profile: "planner",
        side_effect_class: "workspace",
      },
    });

    const result = await executeWorkboardTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      },
      "workboard.clarification.request",
      "tool-call-1",
      { work_item_id: item.work_item_id, question: "Need a concrete API contract?" },
      { work_session_key: subagent.session_key },
    );

    expect(result?.error).toBeUndefined();
    const row = await db.get<{ key: string; lane: string; kind: string; message_text: string }>(
      `SELECT key, lane, kind, message_text
       FROM lane_queue_signals
       WHERE tenant_id = ?`,
      [DEFAULT_TENANT_ID],
    );
    expect(row?.key).toBe(mainSessionKey);
    expect(row?.lane).toBe("main");
    expect(row?.kind).toBe("steer");
    expect(row?.message_text).toContain(item.work_item_id);

    const pausedSubagent = await workboard.getSubagent({
      scope,
      subagent_id: subagent.subagent_id,
    });
    expect(pausedSubagent?.status).toBe("paused");

    const clarificationId = JSON.parse(result?.output ?? "{}") as {
      clarification?: { clarification_id?: string };
    };
    const answer = await executeWorkboardTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      },
      "workboard.clarification.answer",
      "tool-call-2",
      {
        clarification_id: clarificationId.clarification?.clarification_id,
        answer_text: "Use the internal JSON contract.",
      },
      { work_session_key: mainSessionKey },
    );

    expect(answer?.error).toBeUndefined();
    const plannerTasks = await workboard.listTasks({
      scope,
      work_item_id: item.work_item_id,
    });
    expect(
      plannerTasks.some((task) => task.execution_profile === "planner" && task.status === "queued"),
    ).toBe(true);
  });

  it("keeps interaction broad while denying privileged workboard mutators", async () => {
    const interaction = getExecutionProfile("interaction");
    expect(
      isToolAllowedWithDenylist(
        interaction.tool_allowlist,
        interaction.tool_denylist,
        "workboard.item.update",
      ),
    ).toBe(false);
    expect(
      isToolAllowedWithDenylist(
        interaction.tool_allowlist,
        interaction.tool_denylist,
        "workboard.capture",
      ),
    ).toBe(true);
    expect(
      isToolAllowedWithDenylist(
        interaction.tool_allowlist,
        interaction.tool_denylist,
        "subagent.spawn",
      ),
    ).toBe(true);

    const planner = getExecutionProfile("planner");
    expect(
      isToolAllowedWithDenylist(planner.tool_allowlist, planner.tool_denylist, "subagent.spawn"),
    ).toBe(true);
    expect(
      isToolAllowedWithDenylist(
        planner.tool_allowlist,
        planner.tool_denylist,
        "workboard.subagent.spawn",
      ),
    ).toBe(false);
  });

  it("creates one planner subagent per backlog item and completes planner tasks", async () => {
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
      createdFromSessionKey: "agent:default:test:default:channel:thread-2",
      item: { kind: "action", title: "Planner orchestration" },
    });
    await workboard.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        status: "queued",
        execution_profile: "planner",
        side_effect_class: "workspace",
      },
    });

    const orchestrator = new WorkboardOrchestrator({
      db,
      agents: createFakeAgents("planner completed"),
    });

    await orchestrator.tick();

    const subagents = await workboard.listSubagents({
      scope,
      work_item_id: item.work_item_id,
      execution_profile: "planner",
      statuses: ["running", "paused", "closed", "failed"],
      limit: 10,
    });
    expect(subagents.subagents).toHaveLength(1);
    expect(subagents.subagents[0]?.status).toBe("paused");
    expect(subagents.subagents[0]?.parent_session_key).toBe(item.created_from_session_key);

    const tasks = await workboard.listTasks({
      scope,
      work_item_id: item.work_item_id,
    });
    expect(tasks[0]?.status).toBe("completed");
  });

  it("blocks ready transitions until the readiness gate passes", async () => {
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
      createdFromSessionKey: "agent:default:test:default:channel:thread-4",
      item: { kind: "action", title: "Readiness gate" },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.refinement.phase",
      value_json: "refining",
      provenance_json: { source: "test" },
    });

    await expect(
      workboard.transitionItem({
        scope,
        work_item_id: item.work_item_id,
        status: "ready",
      }),
    ).rejects.toMatchObject({ code: "readiness_gate_failed" });

    await workboard.updateItem({
      scope,
      work_item_id: item.work_item_id,
      patch: { acceptance: { done: "implemented" } },
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

    const ready = await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "ready",
    });
    expect(ready?.status).toBe("ready");
  });

  it("auto-dispatches ready work to an executor subagent and completes the item", async () => {
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
      createdFromSessionKey: "agent:default:test:default:channel:thread-3",
      item: { kind: "action", title: "Executor dispatch", acceptance: { done: "implemented" } },
    });
    await workboard.createTask({
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
    await workboard.transitionItem({
      scope,
      work_item_id: item.work_item_id,
      status: "ready",
    });

    const dispatcher = new WorkboardDispatcher({
      db,
      agents: createFakeAgents("executor completed"),
      sessionLaneNodeAttachmentDal: attachmentDal,
    });

    await dispatcher.tick();

    const refreshed = await workboard.getItem({
      scope,
      work_item_id: item.work_item_id,
    });
    expect(refreshed?.status).toBe("done");

    const tasks = await workboard.listTasks({
      scope,
      work_item_id: item.work_item_id,
    });
    expect(tasks[0]?.status).toBe("completed");

    const subagents = await workboard.listSubagents({
      scope,
      work_item_id: item.work_item_id,
      statuses: ["closed", "failed", "running", "paused"],
      limit: 10,
    });
    expect(subagents.subagents[0]?.status).toBe("closed");
    expect(subagents.subagents[0]?.parent_session_key).toBe(item.created_from_session_key);
  });
});
