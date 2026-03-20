import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { GatewayContainer } from "../../src/container.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { buildWorkFocusDigest } from "../../src/modules/agent/runtime/work-focus-digest.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { WorkboardReconciler } from "../../src/modules/workboard/reconciler.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { createGatewayWorkboardService } from "../../src/modules/workboard/service.js";
import { SessionLaneNodeAttachmentDal } from "../../src/modules/agent/session-lane-node-attachment-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("WorkBoard orchestration follow-up runtime behavior", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("requires human intervention after the second orphaned execution retry", async () => {
    db = openTestSqliteDb();
    const _attachmentDal = new SessionLaneNodeAttachmentDal(db);
    const approvalDal = new ApprovalDal(db);
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const item = await workboard.createItem({
      scope,
      createdFromSessionKey: "agent:default:test:default:channel:thread-8",
      item: { kind: "action", title: "Second orphan intervention", acceptance: { done: true } },
    });
    const executionTask = await workboard.createTask({
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
      key: "work.dispatch.phase",
      value_json: "running",
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
    await workboard.updateTask({
      scope,
      task_id: executionTask.task_id,
      patch: {
        status: "running",
        started_at: new Date().toISOString(),
      },
    });

    await workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
      key: `work.dispatch.orphan_retry.${executionTask.task_id}`,
      value_json: 1,
      provenance_json: { source: "test" },
    });

    const reconciler = new WorkboardReconciler({
      db,
      approvalDal,
    });
    await reconciler.tick();

    const blockedItem = await workboard.getItem({
      scope,
      work_item_id: item.work_item_id,
    });
    expect(blockedItem).toMatchObject({ status: "blocked" });

    const pausedTask = await workboard.getTask({
      scope,
      task_id: executionTask.task_id,
    });
    expect(pausedTask).toMatchObject({
      status: "paused",
      approval_id: expect.any(String),
    });

    expect(
      await workboard.getStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
        key: "work.dispatch.phase",
      }),
    ).toMatchObject({ value_json: "awaiting_human" });

    const approvalRow = await approvalDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: pausedTask?.approval_id ?? "",
    });
    expect(approvalRow).toMatchObject({
      kind: "work.intervention",
      work_item_id: item.work_item_id,
      work_item_task_id: executionTask.task_id,
    });
  });

  it("keeps leased work read-only for operator transitions while allowing system transitions", async () => {
    db = openTestSqliteDb();
    const _attachmentDal = new SessionLaneNodeAttachmentDal(db);
    const workboard = new WorkboardDal(db);
    const service = createGatewayWorkboardService({ db });
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const item = await workboard.createItem({
      scope,
      createdFromSessionKey: "agent:default:test:default:channel:thread-lock",
      item: { kind: "action", title: "Lock operator transitions", acceptance: { done: true } },
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
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "ready" });
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "doing" });
    await workboard.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        status: "running",
        execution_profile: "executor_rw",
        side_effect_class: "workspace",
      },
    });

    await expect(
      service.transitionItem({
        scope,
        work_item_id: item.work_item_id,
        status: "blocked",
        reason: "Operator attempted update",
      }),
    ).rejects.toThrow("work item is read-only while actively leased to an agent");

    await expect(
      service.transitionItemSystem({
        scope,
        work_item_id: item.work_item_id,
        status: "blocked",
        reason: "System reconciliation",
      }),
    ).resolves.toMatchObject({ status: "blocked" });
  });

  it("denies intervention approvals by cancelling blocked work even when other tasks are active", async () => {
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
      createdFromSessionKey: "agent:default:test:default:channel:thread-denied-intervention",
      item: { kind: "action", title: "Denied intervention", acceptance: { done: true } },
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

    const interventionTask = await workboard.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        status: "paused",
        execution_profile: "executor_rw",
        side_effect_class: "workspace",
      },
    });
    const activeTask = await workboard.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        status: "running",
        execution_profile: "executor_rw",
        side_effect_class: "workspace",
      },
    });
    const approval = await approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `work.intervention:${item.work_item_id}:${randomUUID()}`,
      prompt: "Deny intervention?",
      motivation: "Manual intervention is required to continue this work item.",
      kind: "work.intervention",
      status: "awaiting_human",
      workItemId: item.work_item_id,
      workItemTaskId: interventionTask.task_id,
    });
    await workboard.updateTask({
      scope,
      task_id: interventionTask.task_id,
      patch: { approval_id: approval.approval_id },
    });

    await expect(
      service.resolveInterventionApproval({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        work_item_id: item.work_item_id,
        work_item_task_id: interventionTask.task_id,
        decision: "denied",
        reason: "Stop this work",
      }),
    ).resolves.toMatchObject({ status: "cancelled" });

    expect(await workboard.getItem({ scope, work_item_id: item.work_item_id })).toMatchObject({
      status: "cancelled",
    });
    expect(await workboard.getTask({ scope, task_id: interventionTask.task_id })).toMatchObject({
      status: "cancelled",
      approval_id: null,
      result_summary: "Stop this work",
    });
    expect(await workboard.getTask({ scope, task_id: activeTask.task_id })).toMatchObject({
      status: "cancelled",
    });
    expect(
      await workboard.getStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
        key: "work.dispatch.phase",
      }),
    ).toMatchObject({ value_json: "cancelled" });
  });

  it("includes refinement and ownership details in the work focus digest", async () => {
    db = openTestSqliteDb();
    const _attachmentDal = new SessionLaneNodeAttachmentDal(db);
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const item = await workboard.createItem({
      scope,
      createdFromSessionKey: "agent:default:test:default:channel:thread-6",
      item: { kind: "action", title: "Digest detail", acceptance: { done: true } },
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
    await db.run(
      `UPDATE work_items
       SET status = 'doing'
       WHERE tenant_id = ? AND work_item_id = ?`,
      [DEFAULT_TENANT_ID, item.work_item_id],
    );
    await workboard.createSubagent({
      scope,
      subagentId: "323e4567-e89b-12d3-a456-426614174111",
      subagent: {
        work_item_id: item.work_item_id,
        execution_profile: "executor_rw",
        session_key: "agent:default:subagent:323e4567-e89b-12d3-a456-426614174111",
        lane: "subagent",
        status: "running",
      },
    });

    const digest = await buildWorkFocusDigest({
      container: {
        db,
        redactionEngine: undefined,
        logger: { warn: () => undefined } as GatewayContainer["logger"],
      },
      scope,
    });

    expect(digest).toContain("refinement=done");
    expect(digest).toContain("dispatch=running");
    expect(digest).toContain("owners=executor_rw:running");
  });
});
