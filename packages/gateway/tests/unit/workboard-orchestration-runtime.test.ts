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
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { makeClient } from "./ws-workboard.test-support.js";

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

describe("WorkBoard orchestration runtime", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("keeps interaction broad while planner and executor default to high-level orchestration tools", async () => {
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
        "workboard.item.transition",
      ),
    ).toBe(true);
    expect(
      isToolAllowedWithDenylist(
        planner.tool_allowlist,
        planner.tool_denylist,
        "workboard.task.create",
      ),
    ).toBe(false);
    expect(
      isToolAllowedWithDenylist(
        planner.tool_allowlist,
        planner.tool_denylist,
        "workboard.subagent.spawn",
      ),
    ).toBe(false);

    const executor = getExecutionProfile("executor_rw");
    expect(
      isToolAllowedWithDenylist(
        executor.tool_allowlist,
        executor.tool_denylist,
        "workboard.clarification.request",
      ),
    ).toBe(true);
    expect(
      isToolAllowedWithDenylist(
        executor.tool_allowlist,
        executor.tool_denylist,
        "workboard.item.transition",
      ),
    ).toBe(false);
    expect(
      isToolAllowedWithDenylist(
        executor.tool_allowlist,
        executor.tool_denylist,
        "workboard.state.set",
      ),
    ).toBe(false);
  });

  it("broadcasts work.item.created when workboard.capture adds backlog work", async () => {
    db = openTestSqliteDb();
    const cm = new ConnectionManager();
    makeClient(cm);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;

    const result = await executeWorkboardTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
        broadcastDeps: { connectionManager: cm },
      },
      "workboard.capture",
      "tool-call-capture-1",
      { title: "Captured with broadcast" },
      { work_conversation_key: "agent:default:test:default:channel:thread-capture-broadcast" },
    );

    expect(result?.error).toBeUndefined();
    const output = JSON.parse(result?.output ?? "{}") as {
      work_item_id?: string;
      status?: string;
      refinement_phase?: string;
    };
    expect(output.work_item_id).toBeTruthy();
    expect(output.refinement_phase).toBe("new");

    const outboxRow = await waitForMatch(
      async () =>
        await db.get<{ payload_json: string }>(
          `SELECT payload_json
           FROM outbox
           WHERE tenant_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
          [DEFAULT_TENANT_ID],
        ),
      (row) => typeof row?.payload_json === "string",
    );
    const event = JSON.parse(String(outboxRow?.payload_json ?? "{}")) as {
      message?: {
        type?: string;
        payload?: { item?: { work_item_id?: string; title?: string; status?: string } };
      };
    };
    expect(event.message?.type).toBe("work.item.created");
    expect(event.message?.payload?.item?.work_item_id).toBe(output.work_item_id);
    expect(event.message?.payload?.item?.title).toBe("Captured with broadcast");
    expect(event.message?.payload?.item?.status).toBe(output.status);

    const workboard = new WorkboardDal(db);
    const item = await workboard.getItem({
      scope,
      work_item_id: output.work_item_id ?? "",
    });
    expect(item?.title).toBe("Captured with broadcast");
    const tasks = await workboard.listTasks({
      scope,
      work_item_id: output.work_item_id ?? "",
    });
    expect(
      tasks.some((task) => task.execution_profile === "planner" && task.status === "queued"),
    ).toBe(true);
  });

  it("still captures work when broadcast deps are unavailable", async () => {
    db = openTestSqliteDb();
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;

    const result = await executeWorkboardTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      },
      "workboard.capture",
      "tool-call-capture-2",
      { title: "Captured without broadcast" },
      {
        work_conversation_key:
          "agent:default:test:default:channel:thread-capture-without-broadcast",
      },
    );

    expect(result?.error).toBeUndefined();
    const output = JSON.parse(result?.output ?? "{}") as {
      work_item_id?: string;
      refinement_phase?: string;
    };
    expect(output.work_item_id).toBeTruthy();
    expect(output.refinement_phase).toBe("new");

    const workboard = new WorkboardDal(db);
    const item = await workboard.getItem({
      scope,
      work_item_id: output.work_item_id ?? "",
    });
    expect(item?.title).toBe("Captured without broadcast");
    const tasks = await workboard.listTasks({
      scope,
      work_item_id: output.work_item_id ?? "",
    });
    expect(
      tasks.some((task) => task.execution_profile === "planner" && task.status === "queued"),
    ).toBe(true);
  });

  it("creates one planner subagent per backlog item and completes planner tasks", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const item = await workboard.createItem({
      scope,
      createdFromConversationKey: "agent:default:test:default:channel:thread-2",
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
    expect(subagents.subagents[0]?.parent_conversation_key).toBe(
      item.created_from_conversation_key,
    );

    const tasks = await workboard.listTasks({
      scope,
      work_item_id: item.work_item_id,
    });
    expect(tasks[0]?.status).toBe("completed");
  });

  it("blocks ready transitions until the readiness gate passes", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const item = await workboard.createItem({
      scope,
      createdFromConversationKey: "agent:default:test:default:channel:thread-4",
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
      value_json: "done",
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
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const item = await workboard.createItem({
      scope,
      createdFromConversationKey: "agent:default:test:default:channel:thread-3",
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
      value_json: "done",
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
    });

    await dispatcher.tick();

    const refreshed = await waitForMatch(
      async () =>
        await workboard.getItem({
          scope,
          work_item_id: item.work_item_id,
        }),
      (value) => value?.status === "done",
    );
    expect(refreshed?.status).toBe("done");

    const tasks = await waitForMatch(
      async () =>
        await workboard.listTasks({
          scope,
          work_item_id: item.work_item_id,
        }),
      (value) => value.some((task) => task.status === "completed"),
    );
    expect(tasks[0]?.status).toBe("completed");

    const subagents = await workboard.listSubagents({
      scope,
      work_item_id: item.work_item_id,
      statuses: ["closed", "failed", "running", "paused"],
      limit: 10,
    });
    expect(subagents.subagents[0]?.status).toBe("closed");
    expect(subagents.subagents[0]?.parent_conversation_key).toBe(
      item.created_from_conversation_key,
    );
  });
});
