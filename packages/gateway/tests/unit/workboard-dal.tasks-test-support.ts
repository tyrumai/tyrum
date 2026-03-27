import { expect, it } from "vitest";
import type { WorkboardDalFixture } from "./workboard-dal.test-support.js";

function registerTaskCrudTests(fixture: WorkboardDalFixture): void {
  it("creates tasks, subagents, links, and scope activity", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

    const a = await dal.createItem({
      scope,
      item: { kind: "action", title: "A", created_from_conversation_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });
    const b = await dal.createItem({
      scope,
      item: { kind: "action", title: "B", created_from_conversation_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });

    await dal.upsertScopeActivity({
      scope,
      last_active_conversation_key: "agent:default:main",
      updated_at_ms: 1_709_000_000_000,
    });
    const activity = await dal.getScopeActivity({ scope });
    expect(activity).toMatchObject({
      last_active_conversation_key: "agent:default:main",
      updated_at_ms: 1_709_000_000_000,
    });

    const link = await dal.createLink({
      scope,
      work_item_id: a.work_item_id,
      linked_work_item_id: b.work_item_id,
      kind: "depends_on",
      meta_json: { note: "A blocks on B" },
    });
    expect(link.kind).toBe("depends_on");
    const links = await dal.listLinks({ scope, work_item_id: a.work_item_id });
    expect(links.links.map((l) => l.linked_work_item_id)).toEqual([b.work_item_id]);

    const task = await dal.createTask({
      scope,
      task: {
        work_item_id: a.work_item_id,
        execution_profile: "planner",
        side_effect_class: "none",
      },
      createdAtIso: "2026-02-27T00:00:02.000Z",
    });
    expect(task.status).toBe("queued");

    const tasks = await dal.listTasks({ scope, work_item_id: a.work_item_id });
    expect(tasks.map((t) => t.task_id)).toEqual([task.task_id]);

    const updatedTask = await dal.updateTask({
      scope,
      task_id: task.task_id,
      patch: { status: "running", started_at: "2026-02-27T00:00:03.000Z" },
      updatedAtIso: "2026-02-27T00:00:03.000Z",
    });
    expect(updatedTask).toBeDefined();
    expect(updatedTask!.status).toBe("running");

    const subagentId = "00000000-0000-0000-0000-000000000001";
    const subagent = await dal.createSubagent({
      scope,
      subagent: {
        execution_profile: "executor",
        conversation_key: `agent:default:subagent:${subagentId}`,
        work_item_id: a.work_item_id,
        work_item_task_id: task.task_id,
      },
      subagentId,
      createdAtIso: "2026-02-27T00:00:04.000Z",
    });
    expect(subagent.status).toBe("running");

    const heartbeat = await dal.heartbeatSubagent({
      scope,
      subagent_id: subagent.subagent_id,
      heartbeatAtIso: "2026-02-27T00:00:05.000Z",
    });
    expect(heartbeat).toBeDefined();
    expect(heartbeat!.last_heartbeat_at).toBe("2026-02-27T00:00:05.000Z");

    const fetched = await dal.getSubagent({ scope, subagent_id: subagent.subagent_id });
    expect(fetched).toBeDefined();
    expect(fetched!.subagent_id).toBe(subagent.subagent_id);

    const running = await dal.listSubagents({ scope, statuses: ["running"] });
    expect(running.subagents.map((s) => s.subagent_id)).toEqual([subagent.subagent_id]);

    const closed = await dal.closeSubagent({
      scope,
      subagent_id: subagent.subagent_id,
      closedAtIso: "2026-02-27T00:00:06.000Z",
    });
    expect(closed).toBeDefined();
    expect(closed!.status).toBe("closing");

    const closing = await dal.listSubagents({ scope, statuses: ["closing"] });
    expect(closing.subagents.map((s) => s.subagent_id)).toEqual([subagent.subagent_id]);
  });

  it("persists subagent close metadata (closed_at + reason)", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();
    const db = fixture.db();

    const subagentId = "00000000-0000-0000-0000-000000000123";
    const created = await dal.createSubagent({
      scope,
      subagent: {
        execution_profile: "executor",
        conversation_key: `agent:default:subagent:${subagentId}`,
      },
      subagentId,
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const closedAtIso = "2026-02-27T00:00:01.000Z";
    await dal.closeSubagent({
      scope,
      subagent_id: created.subagent_id,
      reason: "requested by operator",
      closedAtIso,
    });

    const raw = await db!.get<Record<string, unknown>>(
      `SELECT *
       FROM subagents
       WHERE subagent_id = ?`,
      [created.subagent_id],
    );
    expect(raw).toBeDefined();
    expect(raw!.closed_at).toBe(closedAtIso);
    expect(raw!.close_reason).toBe("requested by operator");
  });

  it("infers subagent work_item_id from work_item_task_id", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

    const item = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Parent task owner",
        created_from_conversation_key: "agent:default:main",
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });
    const task = await dal.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        execution_profile: "executor",
        side_effect_class: "none",
      },
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });

    const subagent = await dal.createSubagent({
      scope,
      subagent: {
        execution_profile: "executor",
        conversation_key: "agent:default:subagent:inferred-owner",
        work_item_task_id: task.task_id,
      },
      subagentId: "00000000-0000-0000-0000-000000000124",
      createdAtIso: "2026-02-27T00:00:02.000Z",
    });

    expect(subagent.work_item_task_id).toBe(task.task_id);
    expect(subagent.work_item_id).toBe(item.work_item_id);
  });
}

function registerDependencyValidationTests(fixture: WorkboardDalFixture): void {
  it("rejects cross-work-item task dependencies", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

    const a = await dal.createItem({
      scope,
      item: { kind: "action", title: "A", created_from_conversation_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });
    const b = await dal.createItem({
      scope,
      item: { kind: "action", title: "B", created_from_conversation_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });

    const taskB = await dal.createTask({
      scope,
      task: {
        work_item_id: b.work_item_id,
        execution_profile: "planner",
        side_effect_class: "none",
      },
      createdAtIso: "2026-02-27T00:00:02.000Z",
    });

    await expect(
      dal.createTask({
        scope,
        task: {
          work_item_id: a.work_item_id,
          depends_on: [taskB.task_id],
          execution_profile: "planner",
          side_effect_class: "none",
        },
        createdAtIso: "2026-02-27T00:00:03.000Z",
      }),
    ).rejects.toThrow(/depends_on|work item|scope/i);
  });

  it("rejects depends_on task ids that do not exist", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

    const item = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Missing depends_on",
        created_from_conversation_key: "agent:default:main",
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    await expect(
      dal.createTask({
        scope,
        task: {
          work_item_id: item.work_item_id,
          depends_on: ["00000000-0000-0000-0000-000000000099"],
          execution_profile: "planner",
          side_effect_class: "none",
        },
        createdAtIso: "2026-02-27T00:00:01.000Z",
      }),
    ).rejects.toThrow(/depends_on.*not found/i);
  });

  it("rejects depends_on that includes the task id itself", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

    const item = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Self depends_on",
        created_from_conversation_key: "agent:default:main",
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const taskId = "00000000-0000-0000-0000-000000000001";
    await expect(
      dal.createTask({
        scope,
        task: {
          work_item_id: item.work_item_id,
          depends_on: [taskId],
          execution_profile: "planner",
          side_effect_class: "none",
        },
        taskId,
        createdAtIso: "2026-02-27T00:00:01.000Z",
      }),
    ).rejects.toThrow(/depends_on.*itself/i);
  });
}

function registerDependencyGraphTests(fixture: WorkboardDalFixture): void {
  it("rejects task dependency cycles", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

    const item = await dal.createItem({
      scope,
      item: { kind: "action", title: "Cycle", created_from_conversation_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const a = await dal.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        execution_profile: "planner",
        side_effect_class: "none",
      },
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });
    const b = await dal.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        execution_profile: "planner",
        side_effect_class: "none",
      },
      createdAtIso: "2026-02-27T00:00:02.000Z",
    });

    await dal.updateTask({
      scope,
      task_id: a.task_id,
      patch: { depends_on: [b.task_id] },
      updatedAtIso: "2026-02-27T00:00:03.000Z",
    });

    await expect(
      dal.updateTask({
        scope,
        task_id: b.task_id,
        patch: { depends_on: [a.task_id] },
        updatedAtIso: "2026-02-27T00:00:04.000Z",
      }),
    ).rejects.toThrow(/cycle/i);
  });

  it("normalizes task depends_on entries on read", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();
    const db = fixture.db();

    const item = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Read normalization",
        created_from_conversation_key: "agent:default:main",
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const root = await dal.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        execution_profile: "planner",
        side_effect_class: "none",
      },
      taskId: "00000000-0000-0000-0000-000000000001",
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });

    const rawTaskId = "00000000-0000-0000-0000-000000000002";
    const createdAtIso = "2026-02-27T00:00:02.000Z";
    await db!.run(
      `INSERT INTO work_item_tasks (
         tenant_id,
         task_id,
         work_item_id,
         status,
         depends_on_json,
         execution_profile,
         side_effect_class,
         turn_id,
         approval_id,
         artifacts_json,
         started_at,
         finished_at,
         result_summary,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scope.tenant_id,
        rawTaskId,
        item.work_item_id,
        "queued",
        JSON.stringify([`  ${root.task_id}  `, root.task_id, "", "   ", root.task_id]),
        "planner",
        "none",
        null,
        null,
        "[]",
        null,
        null,
        null,
        createdAtIso,
        createdAtIso,
      ],
    );

    const tasks = await dal.listTasks({ scope, work_item_id: item.work_item_id });
    const raw = tasks.find((t) => t.task_id === rawTaskId);
    expect(raw).toBeDefined();
    expect(raw!.depends_on).toEqual([root.task_id]);
  });

  it("leases runnable tasks respecting fan-out/fan-in dependencies", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

    const item = await dal.createItem({
      scope,
      item: { kind: "action", title: "DAG", created_from_conversation_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const root = await dal.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        execution_profile: "planner",
        side_effect_class: "none",
      },
      taskId: "00000000-0000-0000-0000-000000000001",
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });
    const b = await dal.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        depends_on: [root.task_id],
        execution_profile: "planner",
        side_effect_class: "none",
      },
      taskId: "00000000-0000-0000-0000-000000000002",
      createdAtIso: "2026-02-27T00:00:02.000Z",
    });
    const c = await dal.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        depends_on: [root.task_id],
        execution_profile: "planner",
        side_effect_class: "none",
      },
      taskId: "00000000-0000-0000-0000-000000000003",
      createdAtIso: "2026-02-27T00:00:03.000Z",
    });
    const join = await dal.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        depends_on: [b.task_id, c.task_id],
        execution_profile: "planner",
        side_effect_class: "none",
      },
      taskId: "00000000-0000-0000-0000-000000000004",
      createdAtIso: "2026-02-27T00:00:04.000Z",
    });

    const leaseOwner = "test-owner";
    const nowMs = 1_709_000_000_000;
    const ttlMs = 60_000;

    const first = await dal.leaseRunnableTasks({
      scope,
      work_item_id: item.work_item_id,
      lease_owner: leaseOwner,
      nowMs,
      leaseTtlMs: ttlMs,
      limit: 10,
    });
    expect(first.leased.map((x) => x.task.task_id)).toEqual([root.task_id]);
    expect(first.leased[0]!.task.status).toBe("leased");
    expect(first.leased[0]!.lease_expires_at_ms).toBe(nowMs + ttlMs);

    await dal.updateTask({
      scope,
      task_id: root.task_id,
      lease_owner: leaseOwner,
      nowMs: nowMs + 5_000,
      patch: { status: "completed", finished_at: "2026-02-27T00:00:05.000Z" },
      updatedAtIso: "2026-02-27T00:00:05.000Z",
    });

    const second = await dal.leaseRunnableTasks({
      scope,
      work_item_id: item.work_item_id,
      lease_owner: leaseOwner,
      nowMs: nowMs + 1,
      leaseTtlMs: ttlMs,
      limit: 10,
    });
    expect(second.leased.map((x) => x.task.task_id)).toEqual([b.task_id, c.task_id]);

    await dal.updateTask({
      scope,
      task_id: b.task_id,
      lease_owner: leaseOwner,
      nowMs: nowMs + 6_000,
      patch: { status: "completed", finished_at: "2026-02-27T00:00:06.000Z" },
      updatedAtIso: "2026-02-27T00:00:06.000Z",
    });
    await dal.updateTask({
      scope,
      task_id: c.task_id,
      lease_owner: leaseOwner,
      nowMs: nowMs + 6_000,
      patch: { status: "completed", finished_at: "2026-02-27T00:00:06.001Z" },
      updatedAtIso: "2026-02-27T00:00:06.001Z",
    });

    const third = await dal.leaseRunnableTasks({
      scope,
      work_item_id: item.work_item_id,
      lease_owner: leaseOwner,
      nowMs: nowMs + 2,
      leaseTtlMs: ttlMs,
      limit: 10,
    });
    expect(third.leased.map((x) => x.task.task_id)).toEqual([join.task_id]);
  });
}

export function registerTasksTests(fixture: WorkboardDalFixture): void {
  registerTaskCrudTests(fixture);
  registerDependencyValidationTests(fixture);
  registerDependencyGraphTests(fixture);
}
