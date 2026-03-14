import { expect, it } from "vitest";
import type { WorkboardDalFixture } from "./workboard-dal.test-support.js";

function registerLeaseBasicTests(fixture: WorkboardDalFixture): void {
  it("leases tasks when dependencies are 'failed'", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

    const item = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Failed deps",
        created_from_session_key: "agent:default:main",
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
    const child = await dal.createTask({
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

    const leaseOwner = "test-owner";
    const nowMs = Date.parse("2026-02-27T00:00:00.000Z");
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

    await dal.updateTask({
      scope,
      task_id: root.task_id,
      lease_owner: leaseOwner,
      nowMs: nowMs + 1,
      patch: { status: "failed", finished_at: "2026-02-27T00:00:03.000Z" },
      updatedAtIso: "2026-02-27T00:00:03.000Z",
    });

    const second = await dal.leaseRunnableTasks({
      scope,
      work_item_id: item.work_item_id,
      lease_owner: leaseOwner,
      nowMs: nowMs + 2,
      leaseTtlMs: ttlMs,
      limit: 10,
    });
    expect(second.leased.map((x) => x.task.task_id)).toEqual([child.task_id]);
  });

  it("reclaims expired task leases", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();
    const db = fixture.db();

    const item = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Lease expiry",
        created_from_session_key: "agent:default:main",
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const task = await dal.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        execution_profile: "planner",
        side_effect_class: "none",
      },
      taskId: "00000000-0000-0000-0000-000000000001",
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });

    const ownerA = "owner-a";
    const ownerB = "owner-b";
    const nowMs = Date.parse("2026-02-27T00:00:00.000Z");
    const ttlMs = 1_000;

    const first = await dal.leaseRunnableTasks({
      scope,
      work_item_id: item.work_item_id,
      lease_owner: ownerA,
      nowMs,
      leaseTtlMs: ttlMs,
      limit: 10,
    });
    expect(first.leased.map((x) => x.task.task_id)).toEqual([task.task_id]);
    expect(first.leased[0]!.lease_expires_at_ms).toBe(nowMs + ttlMs);

    const beforeExpiry = await dal.leaseRunnableTasks({
      scope,
      work_item_id: item.work_item_id,
      lease_owner: ownerB,
      nowMs: nowMs + ttlMs - 1,
      leaseTtlMs: ttlMs,
      limit: 10,
    });
    expect(beforeExpiry.leased).toEqual([]);

    const afterExpiry = await dal.leaseRunnableTasks({
      scope,
      work_item_id: item.work_item_id,
      lease_owner: ownerB,
      nowMs: nowMs + ttlMs,
      leaseTtlMs: ttlMs,
      limit: 10,
    });
    expect(afterExpiry.leased.map((x) => x.task.task_id)).toEqual([task.task_id]);
    expect(afterExpiry.leased[0]!.lease_expires_at_ms).toBe(nowMs + ttlMs + ttlMs);

    const raw = await db!.get<{ lease_owner: string | null; lease_expires_at_ms: number | null }>(
      `SELECT lease_owner, lease_expires_at_ms
       FROM work_item_tasks
       WHERE task_id = ?`,
      [task.task_id],
    );
    expect(raw).toBeDefined();
    expect(raw!.lease_owner).toBe(ownerB);
    expect(raw!.lease_expires_at_ms).toBe(nowMs + ttlMs + ttlMs);
  });

  it("rejects updating leased tasks without a valid lease owner", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

    const item = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Lease owner enforcement",
        created_from_session_key: "agent:default:main",
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
      taskId: "00000000-0000-0000-0000-000000000001",
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });

    const leaseOwner = "owner-a";
    const nowMs = Date.parse("2026-02-27T00:00:00.000Z");
    const ttlMs = 60_000;

    await dal.leaseRunnableTasks({
      scope,
      work_item_id: item.work_item_id,
      lease_owner: leaseOwner,
      nowMs,
      leaseTtlMs: ttlMs,
      limit: 10,
    });

    await expect(
      dal.updateTask({
        scope,
        task_id: task.task_id,
        patch: { status: "completed", finished_at: "2026-02-27T00:00:02.000Z" },
        updatedAtIso: "2026-02-27T00:00:02.000Z",
      }),
    ).rejects.toThrow(/lease/i);
  });
}

function registerLeaseOwnerAndEventTests(fixture: WorkboardDalFixture): void {
  it("enforces lease owner + expiry when leaving 'leased'", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();
    const db = fixture.db();

    const item = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Lease expiry enforcement",
        created_from_session_key: "agent:default:main",
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
      taskId: "00000000-0000-0000-0000-000000000001",
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });

    const ownerA = "owner-a";
    const ownerB = "owner-b";
    const nowMs = Date.parse("2026-02-27T00:00:00.000Z");
    const ttlMs = 1_000;

    await dal.leaseRunnableTasks({
      scope,
      work_item_id: item.work_item_id,
      lease_owner: ownerA,
      nowMs,
      leaseTtlMs: ttlMs,
      limit: 10,
    });

    await expect(
      dal.updateTask({
        scope,
        task_id: task.task_id,
        lease_owner: ownerB,
        nowMs: nowMs + 1,
        patch: { status: "completed", finished_at: "2026-02-27T00:00:02.000Z" },
        updatedAtIso: "2026-02-27T00:00:02.000Z",
      }),
    ).rejects.toThrow(/mismatch/i);

    await expect(
      dal.updateTask({
        scope,
        task_id: task.task_id,
        lease_owner: ownerA,
        nowMs: nowMs + ttlMs,
        patch: { status: "completed", finished_at: "2026-02-27T00:00:02.000Z" },
        updatedAtIso: "2026-02-27T00:00:02.000Z",
      }),
    ).rejects.toThrow(/expired/i);

    const completed = await dal.updateTask({
      scope,
      task_id: task.task_id,
      lease_owner: ownerA,
      nowMs: nowMs + ttlMs - 1,
      patch: { status: "completed", finished_at: "2026-02-27T00:00:02.000Z" },
      updatedAtIso: "2026-02-27T00:00:02.000Z",
    });
    expect(completed).toBeDefined();
    expect(completed!.status).toBe("completed");

    const raw = await db!.get<{ lease_owner: string | null; lease_expires_at_ms: number | null }>(
      `SELECT lease_owner, lease_expires_at_ms
       FROM work_item_tasks
       WHERE task_id = ?`,
      [task.task_id],
    );
    expect(raw).toBeDefined();
    expect(raw!.lease_owner).toBe(null);
    expect(raw!.lease_expires_at_ms).toBe(null);
  });

  it("emits work.task.* WS events for task lifecycle", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();
    const db = fixture.db();

    const item = await dal.createItem({
      scope,
      item: { kind: "action", title: "Events", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const task = await dal.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        execution_profile: "executor",
        side_effect_class: "none",
      },
      taskId: "00000000-0000-0000-0000-000000000001",
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });

    const leaseOwner = "test-owner";
    const nowMs = 1_709_000_000_000;
    const ttlMs = 60_000;

    await dal.leaseRunnableTasks({
      scope,
      work_item_id: item.work_item_id,
      lease_owner: leaseOwner,
      nowMs,
      leaseTtlMs: ttlMs,
      limit: 10,
    });

    const jobId = "00000000-0000-0000-0000-000000000100";
    const runId = "00000000-0000-0000-0000-000000000101";
    await db!.run(
      `INSERT INTO execution_jobs (tenant_id, job_id, agent_id, workspace_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scope.tenant_id,
        jobId,
        scope.agent_id,
        scope.workspace_id,
        "agent:default:main",
        "main",
        "queued",
        JSON.stringify({ kind: "manual" }),
      ],
    );
    await db!.run(
      `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [scope.tenant_id, runId, jobId, "agent:default:main", "main", "queued", 1],
    );

    await dal.updateTask({
      scope,
      task_id: task.task_id,
      lease_owner: leaseOwner,
      nowMs: nowMs + 1_000,
      patch: { status: "running", run_id: runId, started_at: "2026-02-27T00:00:02.000Z" },
      updatedAtIso: "2026-02-27T00:00:02.000Z",
    });

    const approval = await db!.get<{ approval_id: string }>(
      `INSERT INTO approvals (
         tenant_id,
         approval_id,
         approval_key,
         agent_id,
         workspace_id,
         kind,
         status,
         prompt,
         motivation
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING approval_id`,
      [
        scope.tenant_id,
        "00000000-0000-4000-8000-000000000900",
        "approval:test",
        scope.agent_id,
        scope.workspace_id,
        "policy",
        "queued",
        "approve?",
        "approve?",
      ],
    );
    expect(approval).toBeDefined();

    await dal.updateTask({
      scope,
      task_id: task.task_id,
      patch: { status: "paused", approval_id: approval!.approval_id },
      updatedAtIso: "2026-02-27T00:00:03.000Z",
    });

    await dal.updateTask({
      scope,
      task_id: task.task_id,
      patch: { status: "completed", finished_at: "2026-02-27T00:00:04.000Z", result_summary: "ok" },
      updatedAtIso: "2026-02-27T00:00:04.000Z",
    });

    const outbox = await db!.all<{ topic: string; payload_json: string }>(
      "SELECT topic, payload_json FROM outbox ORDER BY id ASC",
    );
    const broadcasts = outbox
      .filter((row) => row.topic === "ws.broadcast")
      .map((row) => JSON.parse(row.payload_json) as { message?: any; audience?: any });
    const workTaskBroadcasts = broadcasts.filter((row) =>
      row.message?.type?.startsWith("work.task."),
    );
    const workTaskEvents = workTaskBroadcasts.map((row) => row.message);

    for (const row of workTaskBroadcasts) {
      expect(row.audience).toMatchObject({
        roles: ["client"],
        required_scopes: ["operator.read", "operator.write"],
      });
    }

    expect(workTaskEvents.map((evt) => evt.type)).toEqual([
      "work.task.leased",
      "work.task.started",
      "work.task.paused",
      "work.task.completed",
    ]);

    expect(workTaskEvents[0]?.payload?.work_item_id).toBe(item.work_item_id);
    expect(workTaskEvents[0]?.payload?.task_id).toBe(task.task_id);
    expect(workTaskEvents[0]?.payload?.lease_expires_at_ms).toBe(nowMs + ttlMs);
    expect(workTaskEvents[1]?.payload?.run_id).toBe(runId);
    expect(workTaskEvents[2]?.payload?.approval_id).toBe(approval!.approval_id);
    expect(workTaskEvents[3]?.payload?.result_summary).toBe("ok");
  });
}

export function registerLeasesTests(fixture: WorkboardDalFixture): void {
  registerLeaseBasicTests(fixture);
  registerLeaseOwnerAndEventTests(fixture);
}
