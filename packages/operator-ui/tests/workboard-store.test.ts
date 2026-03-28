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
  type WorkTaskEvent,
} from "../src/components/workboard/workboard-store.js";

function makeWorkItem(partial: Partial<Record<string, unknown>> & { work_item_id: string }) {
  return {
    work_item_id: partial.work_item_id,
    status: "backlog",
    title: "Work item",
    kind: "task",
    priority: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as any;
}

describe("workboard-store helpers", () => {
  it("upserts work items by id and keeps newest insert first", () => {
    const first = makeWorkItem({ work_item_id: "wi-1", title: "First" });
    const second = makeWorkItem({ work_item_id: "wi-2", title: "Second" });
    const updatedFirst = makeWorkItem({ work_item_id: "wi-1", title: "First updated" });

    const inserted = upsertWorkItem([first], second);
    expect(inserted.map((item) => item.work_item_id)).toEqual(["wi-2", "wi-1"]);

    const updated = upsertWorkItem(inserted, updatedFirst);
    expect(updated.map((item) => item.work_item_id)).toEqual(["wi-2", "wi-1"]);
    expect(updated[1]?.title).toBe("First updated");
  });

  it("groups work items by status and ignores unknown statuses", () => {
    const items = [
      makeWorkItem({ work_item_id: "wi-backlog", status: "backlog" }),
      makeWorkItem({ work_item_id: "wi-ready", status: "ready" }),
      makeWorkItem({ work_item_id: "wi-done", status: "done" }),
      makeWorkItem({ work_item_id: "wi-unknown", status: "mystery" }),
    ];

    const grouped = groupWorkItemsByStatus(items as any);
    expect(Object.keys(grouped)).toEqual([...WORK_ITEM_STATUSES]);
    expect(grouped.backlog.map((item) => item.work_item_id)).toEqual(["wi-backlog"]);
    expect(grouped.ready.map((item) => item.work_item_id)).toEqual(["wi-ready"]);
    expect(grouped.done.map((item) => item.work_item_id)).toEqual(["wi-done"]);
  });

  it("upserts artifacts, decisions, signals, and state kv entries by id/key", () => {
    const artifacts = upsertWorkArtifact([{ artifact_id: "a-1", title: "old" } as any], {
      artifact_id: "a-1",
      title: "new",
    } as any);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.title).toBe("new");

    const decisions = upsertWorkDecision([{ decision_id: "d-1", chosen: "old" } as any], {
      decision_id: "d-1",
      chosen: "new",
    } as any);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.chosen).toBe("new");

    const signals = upsertWorkSignal([{ signal_id: "s-1", status: "pending" } as any], {
      signal_id: "s-1",
      status: "fired",
    } as any);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.status).toBe("fired");

    const kvEntries = upsertWorkStateKvEntry([{ key: "foo", value_json: { value: 1 } } as any], {
      key: "foo",
      value_json: { value: 2 },
    } as any);
    expect(kvEntries).toHaveLength(1);
    expect(kvEntries[0]?.value_json).toEqual({ value: 2 });
  });

  it("checks work-state-kv event applicability for selected work item", () => {
    expect(
      shouldProcessWorkStateKvUpdate(
        {
          kind: "agent",
          tenant_id: "default",
          agent_id: "default",
          workspace_id: "default",
        } as any,
        null,
      ),
    ).toBe(false);

    expect(
      shouldProcessWorkStateKvUpdate(
        {
          kind: "agent",
          tenant_id: "default",
          agent_id: "default",
          workspace_id: "default",
        } as any,
        "wi-1",
      ),
    ).toBe(true);

    expect(
      shouldProcessWorkStateKvUpdate(
        {
          kind: "work_item",
          tenant_id: "default",
          agent_id: "default",
          workspace_id: "default",
          work_item_id: "wi-1",
        } as any,
        "wi-1",
      ),
    ).toBe(true);

    expect(
      shouldProcessWorkStateKvUpdate(
        {
          kind: "work_item",
          tenant_id: "default",
          agent_id: "default",
          workspace_id: "default",
          work_item_id: "wi-2",
        } as any,
        "wi-1",
      ),
    ).toBe(false);
  });

  it("returns selected work item tasks and empty object for no selection", () => {
    const tasksByWorkItemId = {
      "wi-1": {
        "task-1": {
          task_id: "task-1",
          status: "running",
          last_event_at: "2026-01-01T00:00:00.000Z",
        },
      },
    };

    expect(selectTasksForSelectedWorkItem(tasksByWorkItemId as any, "wi-1")).toEqual(
      tasksByWorkItemId["wi-1"],
    );
    expect(selectTasksForSelectedWorkItem(tasksByWorkItemId as any, null)).toEqual({});
    expect(selectTasksForSelectedWorkItem(tasksByWorkItemId as any, "missing")).toEqual({});
  });

  it("applies all work task event variants", () => {
    const initial = {};

    const leasedEvent: WorkTaskEvent = {
      type: "work.task.leased",
      occurred_at: "2026-01-01T00:00:00.000Z",
      payload: {
        work_item_id: "wi-1",
        task_id: "task-1",
        lease_expires_at_ms: 123,
      },
    };
    const leased = applyWorkTaskEvent(initial, leasedEvent);
    expect(leased["wi-1"]?.["task-1"]).toEqual({
      task_id: "task-1",
      status: "leased",
      last_event_at: "2026-01-01T00:00:00.000Z",
      lease_expires_at_ms: 123,
    });

    const started = applyWorkTaskEvent(leased, {
      type: "work.task.started",
      occurred_at: "2026-01-01T00:00:01.000Z",
      payload: {
        work_item_id: "wi-1",
        task_id: "task-1",
        turn_id: "run-1",
      },
    });
    expect(started["wi-1"]?.["task-1"]?.status).toBe("running");
    expect(started["wi-1"]?.["task-1"]?.turn_id).toBe("run-1");

    const paused = applyWorkTaskEvent(started, {
      type: "work.task.paused",
      occurred_at: "2026-01-01T00:00:02.000Z",
      payload: {
        work_item_id: "wi-1",
        task_id: "task-1",
        approval_id: 7,
      },
    });
    expect(paused["wi-1"]?.["task-1"]?.status).toBe("paused");
    expect(paused["wi-1"]?.["task-1"]?.approval_id).toBe(7);

    const completed = applyWorkTaskEvent(paused, {
      type: "work.task.completed",
      occurred_at: "2026-01-01T00:00:03.000Z",
      payload: {
        work_item_id: "wi-1",
        task_id: "task-1",
        result_summary: "ok",
      },
    });
    expect(completed["wi-1"]?.["task-1"]?.status).toBe("completed");
    expect(completed["wi-1"]?.["task-1"]?.result_summary).toBe("ok");
  });
});
