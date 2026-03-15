import { afterEach, describe, expect, it } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { WorkboardDispatcher } from "../../src/modules/workboard/dispatcher.js";
import { WorkboardOrchestrator } from "../../src/modules/workboard/orchestrator.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import { SessionLaneNodeAttachmentDal } from "../../src/modules/agent/session-lane-node-attachment-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

function createFlakyAgents(replies: Array<string | Error>): AgentRegistry {
  let index = 0;
  return {
    getRuntime: async () =>
      ({
        turn: async () => {
          const next = replies[index] ?? replies.at(-1) ?? "ok";
          index += 1;
          if (next instanceof Error) {
            throw next;
          }
          return { reply: next };
        },
      }) as Awaited<ReturnType<AgentRegistry["getRuntime"]>>,
  } as AgentRegistry;
}

describe("WorkBoard orchestration retries", () => {
  let db: SqliteDb | undefined;
  let attachmentDal: SessionLaneNodeAttachmentDal | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
    attachmentDal = undefined;
  });

  it("recreates planner tasks after transient planner failures", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const item = await workboard.createItem({
      scope,
      createdFromSessionKey: "agent:default:test:default:channel:thread-orch-retry",
      item: { kind: "action", title: "Planner retry" },
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
      agents: createFlakyAgents([new Error("rate limited"), "planner retry completed"]),
    });

    await orchestrator.tick();
    await orchestrator.tick();

    const tasks = await workboard.listTasks({ scope, work_item_id: item.work_item_id });
    expect(tasks.filter((task) => task.execution_profile === "planner")).toHaveLength(2);
    expect(tasks.some((task) => task.status === "failed")).toBe(true);
    expect(tasks.some((task) => task.status === "completed")).toBe(true);

    const subagents = await workboard.listSubagents({
      scope,
      work_item_id: item.work_item_id,
      execution_profile: "planner",
      statuses: ["running", "paused", "closed", "failed"],
      limit: 10,
    });
    expect(subagents.subagents.some((subagent) => subagent.status === "failed")).toBe(true);
    expect(subagents.subagents.some((subagent) => subagent.status === "paused")).toBe(true);
  });

  it("creates a replacement execution task when ready items only have failed executor tasks", async () => {
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
      createdFromSessionKey: "agent:default:test:default:channel:thread-dispatch-retry",
      item: { kind: "action", title: "Dispatch retry", acceptance: { done: true } },
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
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "ready" });
    await workboard.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        status: "failed",
        execution_profile: "executor_rw",
        side_effect_class: "workspace",
        result_summary: "previous run failed",
      },
    });

    const dispatcher = new WorkboardDispatcher({
      db,
      agents: createFlakyAgents(["executor retry completed"]),
      sessionLaneNodeAttachmentDal: attachmentDal,
    });

    await dispatcher.tick();

    expect(await workboard.getItem({ scope, work_item_id: item.work_item_id })).toMatchObject({
      status: "doing",
    });
    const tasks = await workboard.listTasks({ scope, work_item_id: item.work_item_id });
    expect(tasks.filter((task) => task.execution_profile === "executor_rw")).toHaveLength(2);
    expect(tasks.some((task) => task.status === "failed")).toBe(true);
    expect(tasks.some((task) => task.status === "completed")).toBe(true);
  });
});
