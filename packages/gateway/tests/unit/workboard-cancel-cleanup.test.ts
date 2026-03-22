import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { createGatewayWorkboardService } from "../../src/modules/workboard/service.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("Workboard cancel cleanup", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("closes paused subagents and denies intervention approvals when operator cancels blocked work", async () => {
    db = openTestSqliteDb();
    const approvalDal = new ApprovalDal(db);
    const workboard = new WorkboardDal(db);
    const service = createGatewayWorkboardService({ db, approvalDal });
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const item = await workboard.createItem({
      scope,
      createdFromSessionKey: "agent:default:test:default:channel:thread-cancel-paused-subagent",
      item: { kind: "action", title: "Cancel blocked work", acceptance: { done: true } },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.refinement.phase",
      value_json: "done",
      provenance_json: { source: "test" },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.dispatch.phase",
      value_json: "awaiting_human",
      provenance_json: { source: "test" },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: "work.size.class",
      value_json: "small",
      provenance_json: { source: "test" },
    });
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "ready" });
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "doing" });
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "blocked" });

    const pausedTask = await workboard.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        status: "paused",
        execution_profile: "executor_rw",
        side_effect_class: "workspace",
      },
    });
    const pausedSubagent = await workboard.createSubagent({
      scope,
      subagent: {
        work_item_id: item.work_item_id,
        execution_profile: "executor_rw",
        session_key: `agent:default:subagent:${randomUUID()}`,
        status: "paused",
      },
    });
    const approval = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `work.intervention:${item.work_item_id}:${randomUUID()}`,
      prompt: "Cancel blocked work?",
      motivation: "Manual intervention is required to continue this work item.",
      kind: "work.intervention",
      status: "awaiting_human",
      workItemId: item.work_item_id,
      workItemTaskId: pausedTask.task_id,
    });
    await workboard.updateTask({
      scope,
      task_id: pausedTask.task_id,
      patch: { approval_id: approval.approval_id },
    });

    await expect(
      service.transitionItem({
        scope,
        work_item_id: item.work_item_id,
        status: "cancelled",
        reason: "operator cancelled blocked work",
      }),
    ).resolves.toMatchObject({ status: "cancelled" });

    expect(await workboard.getItem({ scope, work_item_id: item.work_item_id })).toMatchObject({
      status: "cancelled",
    });
    expect(await workboard.getTask({ scope, task_id: pausedTask.task_id })).toMatchObject({
      status: "cancelled",
      result_summary: "operator cancelled blocked work",
    });
    expect(
      await workboard.getSubagent({ scope, subagent_id: pausedSubagent.subagent_id }),
    ).toMatchObject({
      status: "closed",
    });
    expect(
      await approvalDal.getById({
        tenantId: DEFAULT_TENANT_ID,
        approvalId: approval.approval_id,
      }),
    ).toMatchObject({
      status: "denied",
    });
  });
});
