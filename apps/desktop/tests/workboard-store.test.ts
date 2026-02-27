import { describe, expect, it } from "vitest";
import type { WorkItem } from "@tyrum/schemas";
import {
  WORK_ITEM_STATUSES,
  applyWorkTaskEvent,
  groupWorkItemsByStatus,
  upsertWorkItem,
  type WorkTasksByWorkItemId,
} from "../src/renderer/lib/workboard-store.js";

const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

function makeWorkItem(overrides: Partial<WorkItem> & Pick<WorkItem, "work_item_id">): WorkItem {
  return {
    ...scope,
    work_item_id: overrides.work_item_id,
    kind: overrides.kind ?? "action",
    title: overrides.title ?? `Item ${overrides.work_item_id}`,
    status: overrides.status ?? "backlog",
    priority: overrides.priority ?? 0,
    created_at: overrides.created_at ?? "2026-02-27T00:00:00Z",
    created_from_session_key: overrides.created_from_session_key ?? "agent:default:main",
    last_active_at: overrides.last_active_at ?? null,
    acceptance: overrides.acceptance,
    fingerprint: overrides.fingerprint,
    budgets: overrides.budgets ?? null,
    parent_work_item_id: overrides.parent_work_item_id ?? null,
    updated_at: overrides.updated_at,
  };
}

describe("workboard-store", () => {
  it("upserts WorkItems by id, prepending new ones", () => {
    const item1 = makeWorkItem({ work_item_id: "w-1", title: "One" });
    const item2 = makeWorkItem({ work_item_id: "w-2", title: "Two" });

    const afterInsert = upsertWorkItem([item1], item2);
    expect(afterInsert.map((i) => i.work_item_id)).toEqual(["w-2", "w-1"]);

    const updated1 = makeWorkItem({ work_item_id: "w-1", title: "One (updated)" });
    const afterUpdate = upsertWorkItem(afterInsert, updated1);
    expect(afterUpdate.map((i) => i.title)).toEqual(["Two", "One (updated)"]);
  });

  it("groups WorkItems into all kanban columns in a stable order", () => {
    const items: WorkItem[] = [
      makeWorkItem({ work_item_id: "w-1", status: "backlog" }),
      makeWorkItem({ work_item_id: "w-2", status: "doing" }),
      makeWorkItem({ work_item_id: "w-3", status: "doing" }),
      makeWorkItem({ work_item_id: "w-4", status: "done" }),
    ];

    const grouped = groupWorkItemsByStatus(items);
    expect(Object.keys(grouped)).toEqual([...WORK_ITEM_STATUSES]);
    expect(grouped.backlog.map((i) => i.work_item_id)).toEqual(["w-1"]);
    expect(grouped.doing.map((i) => i.work_item_id)).toEqual(["w-2", "w-3"]);
    expect(grouped.done.map((i) => i.work_item_id)).toEqual(["w-4"]);
    expect(grouped.failed).toEqual([]);
  });

  it("derives task status transitions from work.task.* events", () => {
    const initial: WorkTasksByWorkItemId = {};

    const leased = applyWorkTaskEvent(initial, {
      type: "work.task.leased",
      occurred_at: "2026-02-27T00:00:01Z",
      payload: {
        ...scope,
        work_item_id: "w-1",
        task_id: "t-1",
        lease_expires_at_ms: 123,
      },
    });

    expect(leased["w-1"]?.["t-1"]?.status).toBe("leased");
    expect(leased["w-1"]?.["t-1"]?.lease_expires_at_ms).toBe(123);

    const started = applyWorkTaskEvent(leased, {
      type: "work.task.started",
      occurred_at: "2026-02-27T00:00:02Z",
      payload: {
        ...scope,
        work_item_id: "w-1",
        task_id: "t-1",
        run_id: "r-1",
      },
    });

    expect(started["w-1"]?.["t-1"]?.status).toBe("running");
    expect(started["w-1"]?.["t-1"]?.run_id).toBe("r-1");

    const paused = applyWorkTaskEvent(started, {
      type: "work.task.paused",
      occurred_at: "2026-02-27T00:00:03Z",
      payload: {
        ...scope,
        work_item_id: "w-1",
        task_id: "t-1",
        approval_id: 7,
      },
    });

    expect(paused["w-1"]?.["t-1"]?.status).toBe("paused");
    expect(paused["w-1"]?.["t-1"]?.approval_id).toBe(7);

    const completed = applyWorkTaskEvent(paused, {
      type: "work.task.completed",
      occurred_at: "2026-02-27T00:00:04Z",
      payload: {
        ...scope,
        work_item_id: "w-1",
        task_id: "t-1",
        result_summary: "ok",
      },
    });

    expect(completed["w-1"]?.["t-1"]?.status).toBe("completed");
    expect(completed["w-1"]?.["t-1"]?.result_summary).toBe("ok");
  });
});

