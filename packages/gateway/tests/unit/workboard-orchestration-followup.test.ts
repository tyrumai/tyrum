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
import { SubagentJanitor } from "../../src/modules/workboard/subagent-janitor.js";
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

async function waitForWorkItemStatus(input: {
  workboard: WorkboardDal;
  scope: { tenant_id: string; agent_id: string; workspace_id: string };
  workItemId: string;
  status: string;
  attempts?: number;
}): Promise<void> {
  const attempts = input.attempts ?? 50;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const item = await input.workboard.getItem({
      scope: input.scope,
      work_item_id: input.workItemId,
    });
    if (item?.status === input.status) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const item = await input.workboard.getItem({
    scope: input.scope,
    work_item_id: input.workItemId,
  });
  expect(item).toMatchObject({ status: input.status });
}

describe("WorkBoard orchestration follow-up behaviors", () => {
  let db: SqliteDb | undefined;
  let attachmentDal: SessionLaneNodeAttachmentDal | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
    attachmentDal = undefined;
  });

  it("does not allow manual transition to doing through workboard tools", async () => {
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
      createdFromSessionKey: "agent:default:test:default:channel:thread-5",
      item: { kind: "action", title: "No manual doing", acceptance: { done: true } },
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

    await expect(
      executeWorkboardTool(
        {
          workspaceLease: {
            db,
            tenantId: DEFAULT_TENANT_ID,
            agentId: DEFAULT_AGENT_ID,
            workspaceId: DEFAULT_WORKSPACE_ID,
          },
        },
        "workboard.item.transition",
        "tool-call-doing",
        { work_item_id: item.work_item_id, status: "doing" },
        { work_session_key: "agent:default:test:default:channel:thread-5" },
      ),
    ).rejects.toThrow("manual transition to doing");
  });

  it("supports deleting scoped WorkBoard entities through the tool surface", async () => {
    db = openTestSqliteDb();
    attachmentDal = new SessionLaneNodeAttachmentDal(db);
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const workSessionKey = "agent:default:test:default:channel:thread-delete";
    const item = await workboard.createItem({
      scope,
      createdFromSessionKey: workSessionKey,
      item: { kind: "action", title: "Delete coverage", acceptance: { done: true } },
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
    const task = await workboard.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        status: "queued",
        execution_profile: "executor_rw",
        side_effect_class: "workspace",
      },
    });
    const artifact = await workboard.createArtifact({
      scope,
      artifact: {
        work_item_id: item.work_item_id,
        kind: "result_summary",
        title: "Artifact",
      },
    });
    const decision = await workboard.createDecision({
      scope,
      decision: {
        work_item_id: item.work_item_id,
        question: "Decision?",
        chosen: "Yes",
        rationale_md: "Because.",
      },
    });
    const signal = await workboard.createSignal({
      scope,
      signal: {
        work_item_id: item.work_item_id,
        trigger_kind: "event",
        trigger_spec_json: { event: "done" },
      },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.custom.flag",
      value_json: true,
      provenance_json: { source: "test" },
    });

    const toolContext = {
      workspaceLease: {
        db,
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
      },
    };

    await expect(
      executeWorkboardTool(
        toolContext,
        "workboard.state.delete",
        "tool-delete-state",
        {
          scope_kind: "work_item",
          work_item_id: item.work_item_id,
          key: "work.custom.flag",
        },
        { work_session_key: workSessionKey },
      ),
    ).resolves.toBeDefined();
    await expect(
      executeWorkboardTool(
        toolContext,
        "workboard.artifact.delete",
        "tool-delete-artifact",
        { artifact_id: artifact.artifact_id },
        { work_session_key: workSessionKey },
      ),
    ).resolves.toBeDefined();
    await expect(
      executeWorkboardTool(
        toolContext,
        "workboard.decision.delete",
        "tool-delete-decision",
        { decision_id: decision.decision_id },
        { work_session_key: workSessionKey },
      ),
    ).resolves.toBeDefined();
    await expect(
      executeWorkboardTool(
        toolContext,
        "workboard.signal.delete",
        "tool-delete-signal",
        { signal_id: signal.signal_id },
        { work_session_key: workSessionKey },
      ),
    ).resolves.toBeDefined();
    await expect(
      executeWorkboardTool(
        toolContext,
        "workboard.task.delete",
        "tool-delete-task",
        { task_id: task.task_id },
        { work_session_key: workSessionKey },
      ),
    ).resolves.toBeDefined();
    await expect(
      executeWorkboardTool(
        toolContext,
        "workboard.item.delete",
        "tool-delete-item",
        { work_item_id: item.work_item_id },
        { work_session_key: workSessionKey },
      ),
    ).resolves.toBeDefined();

    const deletedState = await workboard.getStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.custom.flag",
    });
    expect(deletedState).toBeUndefined();
    expect(
      await workboard.getArtifact({ scope, artifact_id: artifact.artifact_id }),
    ).toBeUndefined();
    expect(
      await workboard.getDecision({ scope, decision_id: decision.decision_id }),
    ).toBeUndefined();
    expect(await workboard.getSignal({ scope, signal_id: signal.signal_id })).toBeUndefined();
    expect(await workboard.getTask({ scope, task_id: task.task_id })).toBeUndefined();
    expect(await workboard.getItem({ scope, work_item_id: item.work_item_id })).toBeUndefined();
  });

  it("prunes closed subagents and clears lane attachments after retention", async () => {
    db = openTestSqliteDb();
    attachmentDal = new SessionLaneNodeAttachmentDal(db);
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const subagent = await workboard.createSubagent({
      scope,
      subagentId: "223e4567-e89b-12d3-a456-426614174111",
      createdAtIso: "2024-01-01T00:00:00.000Z",
      subagent: {
        execution_profile: "executor_rw",
        session_key: "agent:default:subagent:223e4567-e89b-12d3-a456-426614174111",
        lane: "subagent",
        status: "closed",
      },
    });
    await db.run(
      `UPDATE subagents
       SET closed_at = ?, updated_at = ?
       WHERE tenant_id = ? AND subagent_id = ?`,
      [
        "2024-01-01T00:00:00.000Z",
        "2024-01-01T00:00:00.000Z",
        DEFAULT_TENANT_ID,
        subagent.subagent_id,
      ],
    );
    await attachmentDal.upsert({
      tenantId: DEFAULT_TENANT_ID,
      key: subagent.conversation_key,
      lane: "subagent",
      attachedNodeId: "node-test",
      updatedAtMs: 1,
    });

    const janitor = new SubagentJanitor({
      db,
      sessionLaneNodeAttachmentDal: attachmentDal,
      retentionMs: 1_000,
    });
    await janitor.tick();

    expect(
      await workboard.getSubagent({
        scope,
        subagent_id: subagent.subagent_id,
      }),
    ).toBeUndefined();
    expect(
      await attachmentDal.get({
        tenantId: DEFAULT_TENANT_ID,
        key: subagent.conversation_key,
        lane: "subagent",
      }),
    ).toBeUndefined();
  });

  it("automatically requeues orphaned doing work back to ready for redispatch", async () => {
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
      createdFromSessionKey: "agent:default:test:default:channel:thread-7",
      item: { kind: "action", title: "Orphaned doing recovery", acceptance: { done: true } },
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
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.dispatch.phase",
      value_json: "running",
      provenance_json: { source: "test" },
    });
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "ready" });
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "doing" });
    const tasksBefore = await workboard.listTasks({ scope, work_item_id: item.work_item_id });
    const executionTask = tasksBefore.find((task) => task.execution_profile === "executor_rw");
    expect(executionTask).toBeDefined();
    await workboard.updateTask({
      scope,
      task_id: executionTask?.task_id ?? "",
      patch: {
        status: "running",
        started_at: new Date().toISOString(),
      },
    });
    await workboard.deleteStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.size.class",
    });

    const reconciler = new WorkboardReconciler({ db });
    await reconciler.tick();

    expect(
      await workboard.getItem({
        scope,
        work_item_id: item.work_item_id,
      }),
    ).toMatchObject({ status: "ready" });
    expect(
      await workboard.getTask({
        scope,
        task_id: executionTask?.task_id ?? "",
      }),
    ).toMatchObject({ status: "queued" });
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
      agents: createFakeAgents("executor redispatched"),
    });
    await dispatcher.tick();
    await waitForWorkItemStatus({
      workboard,
      scope,
      workItemId: item.work_item_id,
      status: "done",
    });

    expect(
      await workboard.getItem({
        scope,
        work_item_id: item.work_item_id,
      }),
    ).toMatchObject({ status: "done" });
  });
});
