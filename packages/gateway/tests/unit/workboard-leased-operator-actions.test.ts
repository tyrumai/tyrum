import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { SessionLaneNodeAttachmentDal } from "../../src/modules/agent/session-lane-node-attachment-dal.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { createGatewayWorkboardService } from "../../src/modules/workboard/service.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { makeClient, makeDeps } from "./ws-workboard.test-support.js";

const DEFAULT_SCOPE = {
  tenant_id: DEFAULT_TENANT_ID,
  agent_id: DEFAULT_AGENT_ID,
  workspace_id: DEFAULT_WORKSPACE_ID,
} as const;

async function createDoingItem(
  workboard: WorkboardDal,
  title: string,
  createdFromSessionKey: string,
): Promise<{ work_item_id: string }> {
  const item = await workboard.createItem({
    scope: DEFAULT_SCOPE,
    createdFromSessionKey,
    item: { kind: "action", title, acceptance: { done: true } },
  });
  await workboard.setStateKv({
    scope: { kind: "work_item", ...DEFAULT_SCOPE, work_item_id: item.work_item_id },
    key: "work.refinement.phase",
    value_json: "done",
    provenance_json: { source: "test" },
  });
  await workboard.setStateKv({
    scope: { kind: "work_item", ...DEFAULT_SCOPE, work_item_id: item.work_item_id },
    key: "work.size.class",
    value_json: "small",
    provenance_json: { source: "test" },
  });
  await workboard.transitionItem({
    scope: DEFAULT_SCOPE,
    work_item_id: item.work_item_id,
    status: "ready",
  });
  await workboard.transitionItem({
    scope: DEFAULT_SCOPE,
    work_item_id: item.work_item_id,
    status: "doing",
  });
  return item;
}

async function expireTaskLease(db: SqliteDb, taskId: string): Promise<void> {
  await db.run(
    `UPDATE work_item_tasks
     SET lease_expires_at_ms = ?
     WHERE task_id = ?`,
    [Date.now() - 1_000, taskId],
  );
}

describe("Workboard leased operator actions", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("allows operator cancel on leased work and tears down active execution", async () => {
    db = openTestSqliteDb();
    const _attachmentDal = new SessionLaneNodeAttachmentDal(db);
    const workboard = new WorkboardDal(db);
    const service = createGatewayWorkboardService({ db });
    const item = await createDoingItem(
      workboard,
      "Cancel leased work",
      "agent:default:test:default:channel:thread-cancel-leased",
    );

    const task = await workboard.createTask({
      scope: DEFAULT_SCOPE,
      task: {
        work_item_id: item.work_item_id,
        status: "queued",
        execution_profile: "executor_rw",
        side_effect_class: "workspace",
      },
    });
    await workboard.leaseRunnableTasks({
      scope: DEFAULT_SCOPE,
      work_item_id: item.work_item_id,
      lease_owner: "cancel-leased-test-owner",
      nowMs: Date.now(),
      leaseTtlMs: 60_000,
      limit: 10,
    });
    const subagent = await workboard.createSubagent({
      scope: DEFAULT_SCOPE,
      subagent: {
        work_item_id: item.work_item_id,
        execution_profile: "executor_rw",
        session_key: `agent:default:subagent:${randomUUID()}`,
        status: "running",
      },
    });

    await expect(
      service.transitionItem({
        scope: DEFAULT_SCOPE,
        work_item_id: item.work_item_id,
        status: "cancelled",
        reason: "operator cancelled leased work",
      }),
    ).resolves.toMatchObject({ status: "cancelled" });

    const cancelledTask = await db.get<{
      status: string;
      lease_owner: string | null;
      lease_expires_at_ms: number | null;
      finished_at: string | null;
      result_summary: string | null;
    }>(
      `SELECT status, lease_owner, lease_expires_at_ms, finished_at, result_summary
       FROM work_item_tasks
       WHERE task_id = ?`,
      [task.task_id],
    );
    expect(cancelledTask).toMatchObject({
      status: "cancelled",
      lease_owner: null,
      lease_expires_at_ms: null,
      result_summary: "operator cancelled leased work",
    });
    expect(cancelledTask?.finished_at).toBeTruthy();
    const closedSubagent = await db.get<{ status: string; close_reason: string | null }>(
      `SELECT status, close_reason
       FROM subagents
       WHERE subagent_id = ?`,
      [subagent.subagent_id],
    );
    expect(closedSubagent).toMatchObject({
      status: "closed",
      close_reason: "operator cancelled leased work",
    });
  });

  it("rejects operator cancel on backlog leased work without teardown side effects", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const service = createGatewayWorkboardService({ db });
    const item = await workboard.createItem({
      scope: DEFAULT_SCOPE,
      createdFromSessionKey: "agent:default:test:default:channel:thread-backlog-cancel-leased",
      item: { kind: "action", title: "Backlog leased work", acceptance: { done: true } },
    });

    const task = await workboard.createTask({
      scope: DEFAULT_SCOPE,
      task: {
        work_item_id: item.work_item_id,
        status: "queued",
        execution_profile: "planner",
        side_effect_class: "none",
      },
    });
    await workboard.leaseRunnableTasks({
      scope: DEFAULT_SCOPE,
      work_item_id: item.work_item_id,
      lease_owner: "backlog-cancel-leased-test-owner",
      nowMs: Date.now(),
      leaseTtlMs: 60_000,
      limit: 10,
    });

    await expect(
      service.transitionItem({
        scope: DEFAULT_SCOPE,
        work_item_id: item.work_item_id,
        status: "cancelled",
        reason: "operator cancelled backlog leased work",
      }),
    ).rejects.toMatchObject({
      code: "invalid_transition",
      details: {
        from: "backlog",
        to: "cancelled",
      },
    });

    expect(
      await workboard.getItem({
        scope: DEFAULT_SCOPE,
        work_item_id: item.work_item_id,
      }),
    ).toMatchObject({
      status: "backlog",
    });
    expect(
      await db.get<{
        status: string;
        lease_owner: string | null;
        lease_expires_at_ms: number | null;
        finished_at: string | null;
        result_summary: string | null;
      }>(
        `SELECT status, lease_owner, lease_expires_at_ms, finished_at, result_summary
         FROM work_item_tasks
         WHERE task_id = ?`,
        [task.task_id],
      ),
    ).toMatchObject({
      status: "leased",
      lease_owner: "backlog-cancel-leased-test-owner",
      finished_at: null,
      result_summary: null,
    });
  });

  it("allows operator cancel on expired leased work and tears down active execution", async () => {
    db = openTestSqliteDb();
    const _attachmentDal = new SessionLaneNodeAttachmentDal(db);
    const workboard = new WorkboardDal(db);
    const service = createGatewayWorkboardService({ db });
    const item = await createDoingItem(
      workboard,
      "Cancel expired leased work",
      "agent:default:test:default:channel:thread-cancel-expired-leased",
    );

    const task = await workboard.createTask({
      scope: DEFAULT_SCOPE,
      task: {
        work_item_id: item.work_item_id,
        status: "queued",
        execution_profile: "executor_rw",
        side_effect_class: "workspace",
      },
    });
    await workboard.leaseRunnableTasks({
      scope: DEFAULT_SCOPE,
      work_item_id: item.work_item_id,
      lease_owner: "cancel-expired-leased-test-owner",
      nowMs: Date.now(),
      leaseTtlMs: 60_000,
      limit: 10,
    });
    await expireTaskLease(db, task.task_id);
    const subagent = await workboard.createSubagent({
      scope: DEFAULT_SCOPE,
      subagent: {
        work_item_id: item.work_item_id,
        execution_profile: "executor_rw",
        session_key: `agent:default:subagent:${randomUUID()}`,
        status: "running",
      },
    });

    await expect(
      service.transitionItem({
        scope: DEFAULT_SCOPE,
        work_item_id: item.work_item_id,
        status: "cancelled",
        reason: "operator cancelled expired leased work",
      }),
    ).resolves.toMatchObject({ status: "cancelled" });

    const cancelledTask = await db.get<{
      status: string;
      lease_owner: string | null;
      lease_expires_at_ms: number | null;
      finished_at: string | null;
      result_summary: string | null;
    }>(
      `SELECT status, lease_owner, lease_expires_at_ms, finished_at, result_summary
       FROM work_item_tasks
       WHERE task_id = ?`,
      [task.task_id],
    );
    expect(cancelledTask).toMatchObject({
      status: "cancelled",
      lease_owner: null,
      lease_expires_at_ms: null,
      result_summary: "operator cancelled expired leased work",
    });
    expect(cancelledTask?.finished_at).toBeTruthy();
    const closedSubagent = await db.get<{ status: string; close_reason: string | null }>(
      `SELECT status, close_reason
       FROM subagents
       WHERE subagent_id = ?`,
      [subagent.subagent_id],
    );
    expect(closedSubagent).toMatchObject({
      status: "closed",
      close_reason: "operator cancelled expired leased work",
    });
  });

  it("handles work.delete when the active lease has already expired", async () => {
    db = openTestSqliteDb();
    const cm = new ConnectionManager();
    const { id } = makeClient(cm);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm, { db });

    const createRes = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-create-expired-delete",
        type: "work.create",
        payload: {
          tenant_key: "default",
          agent_key: "default",
          workspace_key: "default",
          item: {
            kind: "action",
            title: "Delete expired leased work",
            acceptance: { done: true },
          },
        },
      }),
      deps,
    );
    expect((createRes as { ok: boolean }).ok).toBe(true);
    const workItemId = (
      createRes as {
        result: { item: { work_item_id: string } };
      }
    ).result.item.work_item_id;

    const workboard = new WorkboardDal(db);
    await workboard.setStateKv({
      scope: { kind: "work_item", ...DEFAULT_SCOPE, work_item_id: workItemId },
      key: "work.refinement.phase",
      value_json: "done",
      provenance_json: { source: "test" },
    });
    await workboard.setStateKv({
      scope: { kind: "work_item", ...DEFAULT_SCOPE, work_item_id: workItemId },
      key: "work.size.class",
      value_json: "small",
      provenance_json: { source: "test" },
    });
    await workboard.transitionItem({
      scope: DEFAULT_SCOPE,
      work_item_id: workItemId,
      status: "ready",
    });
    await workboard.transitionItem({
      scope: DEFAULT_SCOPE,
      work_item_id: workItemId,
      status: "doing",
    });
    const task = await workboard.createTask({
      scope: DEFAULT_SCOPE,
      task: {
        work_item_id: workItemId,
        status: "queued",
        execution_profile: "executor_rw",
        side_effect_class: "workspace",
      },
    });
    await workboard.leaseRunnableTasks({
      scope: DEFAULT_SCOPE,
      work_item_id: workItemId,
      lease_owner: "delete-expired-leased-test-owner",
      nowMs: Date.now(),
      leaseTtlMs: 60_000,
      limit: 10,
    });
    await expireTaskLease(db, task.task_id);
    const subagent = await workboard.createSubagent({
      scope: DEFAULT_SCOPE,
      subagent: {
        work_item_id: workItemId,
        work_item_task_id: task.task_id,
        execution_profile: "executor_rw",
        session_key: "subagent-delete-expired",
        status: "running",
      },
    });

    const deleteRes = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-delete-expired-active",
        type: "work.delete",
        payload: {
          tenant_key: "default",
          agent_key: "default",
          workspace_key: "default",
          work_item_id: workItemId,
        },
      }),
      deps,
    );

    expect((deleteRes as { ok: boolean }).ok).toBe(true);
    expect(
      (deleteRes as { result: { item: { work_item_id: string } } }).result.item.work_item_id,
    ).toBe(workItemId);
    const closedSubagent = await db.get<{
      status: string;
      close_reason: string | null;
      work_item_id: string | null;
      work_item_task_id: string | null;
    }>(
      `SELECT status, close_reason, work_item_id, work_item_task_id
       FROM subagents
       WHERE subagent_id = ?`,
      [subagent.subagent_id],
    );
    expect(closedSubagent).toMatchObject({
      status: "closed",
      close_reason: "Deleted by operator.",
      work_item_id: null,
      work_item_task_id: null,
    });
  });
});
