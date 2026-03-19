import { describe, expect, it } from "vitest";
import {
  WORK_ITEM_STATUSES,
  applyWorkTaskEvent,
  groupWorkItemsByStatus,
  selectTasksForSelectedWorkItem,
  shouldProcessWorkStateKvUpdate,
  upsertWorkArtifact,
  upsertWorkDecision,
  upsertWorkItem,
  upsertWorkSignal,
  upsertWorkStateKvEntry,
} from "../src/workboard/workboard-utils.js";

describe("workboard-utils", () => {
  it("upserts work items and groups them by status", () => {
    const w1 = { work_item_id: "w1", status: "backlog" } as any;
    const w2 = { work_item_id: "w2", status: "doing" } as any;

    let items: any[] = [];
    items = upsertWorkItem(items, w1);
    items = upsertWorkItem(items, w2);

    expect(items.map((item) => item.work_item_id)).toEqual(["w2", "w1"]);

    items = upsertWorkItem(items, { ...w1, status: "ready" });
    expect(items.map((item) => item.work_item_id)).toEqual(["w2", "w1"]);
    expect(items[1]?.status).toBe("ready");

    const grouped = groupWorkItemsByStatus([
      ...items,
      { work_item_id: "w3", status: "mystery" } as any,
    ]);

    expect(WORK_ITEM_STATUSES).toContain("backlog");
    expect(grouped.backlog).toEqual([]);
    expect(grouped.ready.map((item) => item.work_item_id)).toEqual(["w1"]);
    expect(grouped.doing.map((item) => item.work_item_id)).toEqual(["w2"]);
  });

  it("upserts work artifacts, decisions, signals, and state KV entries by id", () => {
    const artifact1 = { artifact_id: "a1" } as any;
    const artifact2 = { artifact_id: "a2" } as any;
    const artifacts = upsertWorkArtifact([artifact1], artifact2);
    expect(artifacts.map((a) => a.artifact_id)).toEqual(["a2", "a1"]);

    const decisions = upsertWorkDecision([{ decision_id: "d1" } as any], {
      decision_id: "d1",
      label: "updated",
    } as any);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.label).toBe("updated");

    const signals = upsertWorkSignal([{ signal_id: "s1" } as any], { signal_id: "s2" } as any);
    expect(signals.map((s) => s.signal_id)).toEqual(["s2", "s1"]);

    const entries = upsertWorkStateKvEntry([{ key: "k1", value: 1 } as any], {
      key: "k1",
      value: 2,
    } as any);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.value).toBe(2);
  });

  it("filters work state KV updates by scope and selected work item", () => {
    expect(
      shouldProcessWorkStateKvUpdate({ kind: "work_item", work_item_id: "w1" } as any, null),
    ).toBe(false);
    expect(
      shouldProcessWorkStateKvUpdate({ kind: "work_item", work_item_id: "w1" } as any, "w2"),
    ).toBe(false);
    expect(
      shouldProcessWorkStateKvUpdate({ kind: "work_item", work_item_id: "w1" } as any, "w1"),
    ).toBe(true);
    expect(shouldProcessWorkStateKvUpdate({ kind: "agent" } as any, "w1")).toBe(true);
  });

  it("selects tasks for the currently selected work item", () => {
    const tasks = {
      w1: {
        t1: { task_id: "t1", status: "running", last_event_at: "2026-01-01T00:00:00.000Z" },
      },
    } as any;

    expect(Object.keys(selectTasksForSelectedWorkItem(tasks, null))).toEqual([]);
    expect(Object.keys(selectTasksForSelectedWorkItem(tasks, "missing"))).toEqual([]);
    expect(Object.keys(selectTasksForSelectedWorkItem(tasks, "w1"))).toEqual(["t1"]);
  });

  it("applies work task events and updates task status", () => {
    const leased = {
      type: "work.task.leased",
      occurred_at: "2026-01-01T00:00:00.000Z",
      payload: { work_item_id: "w1", task_id: "t1", lease_expires_at_ms: 123 },
    } as any;

    const started = {
      type: "work.task.started",
      occurred_at: "2026-01-01T00:00:01.000Z",
      payload: { work_item_id: "w1", task_id: "t1", run_id: "run-1" },
    } as any;

    const paused = {
      type: "work.task.paused",
      occurred_at: "2026-01-01T00:00:02.000Z",
      payload: { work_item_id: "w1", task_id: "t1", approval_id: "approval-1" },
    } as any;

    const completed = {
      type: "work.task.completed",
      occurred_at: "2026-01-01T00:00:03.000Z",
      payload: { work_item_id: "w1", task_id: "t1", result_summary: "ok" },
    } as any;

    let tasksByWorkItemId = applyWorkTaskEvent({}, leased);
    expect(tasksByWorkItemId["w1"]?.["t1"]?.status).toBe("leased");
    expect(tasksByWorkItemId["w1"]?.["t1"]?.lease_expires_at_ms).toBe(123);

    tasksByWorkItemId = applyWorkTaskEvent(tasksByWorkItemId, started);
    expect(tasksByWorkItemId["w1"]?.["t1"]?.status).toBe("running");
    expect(tasksByWorkItemId["w1"]?.["t1"]?.run_id).toBe("run-1");

    tasksByWorkItemId = applyWorkTaskEvent(tasksByWorkItemId, paused);
    expect(tasksByWorkItemId["w1"]?.["t1"]?.status).toBe("paused");
    expect(tasksByWorkItemId["w1"]?.["t1"]?.approval_id).toBe("approval-1");

    tasksByWorkItemId = applyWorkTaskEvent(tasksByWorkItemId, completed);
    expect(tasksByWorkItemId["w1"]?.["t1"]?.status).toBe("completed");
    expect(tasksByWorkItemId["w1"]?.["t1"]?.result_summary).toBe("ok");
    expect(tasksByWorkItemId["w1"]?.["t1"]?.last_event_at).toBe("2026-01-01T00:00:03.000Z");
  });
});
