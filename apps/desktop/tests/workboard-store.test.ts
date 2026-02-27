import { describe, expect, it } from "vitest";
import type {
  AgentStateKVEntry,
  DecisionRecord,
  WorkArtifact,
  WorkItem,
  WorkSignal,
  WorkStateKVScope,
} from "@tyrum/schemas";
import {
  WORK_ITEM_STATUSES,
  applyWorkTaskEvent,
  groupWorkItemsByStatus,
  upsertWorkItem,
  upsertWorkArtifact,
  upsertWorkDecision,
  upsertWorkSignal,
  upsertWorkStateKvEntry,
  type WorkTasksByWorkItemId,
  type WorkTaskSummary,
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

  it("upserts drilldown entities, prepending new ones", () => {
    const artifact1: WorkArtifact = {
      artifact_id: "a-1",
      ...scope,
      work_item_id: "w-1",
      kind: "candidate_plan",
      title: "Plan v1",
      refs: [],
      created_at: "2026-02-27T00:00:00Z",
    };
    const artifact2: WorkArtifact = {
      artifact_id: "a-2",
      ...scope,
      work_item_id: "w-1",
      kind: "verification_report",
      title: "Verify v1",
      refs: [],
      created_at: "2026-02-27T00:00:01Z",
    };

    const artifactsInserted = upsertWorkArtifact([artifact1], artifact2);
    expect(artifactsInserted.map((a) => a.artifact_id)).toEqual(["a-2", "a-1"]);

    const artifact1Updated: WorkArtifact = { ...artifact1, title: "Plan v2" };
    const artifactsUpdated = upsertWorkArtifact(artifactsInserted, artifact1Updated);
    expect(artifactsUpdated.map((a) => a.title)).toEqual(["Verify v1", "Plan v2"]);

    const decision1: DecisionRecord = {
      decision_id: "d-1",
      ...scope,
      work_item_id: "w-1",
      question: "Q?",
      chosen: "A",
      alternatives: [],
      rationale_md: "Because",
      input_artifact_ids: [],
      created_at: "2026-02-27T00:00:00Z",
    };
    const decision2: DecisionRecord = {
      decision_id: "d-2",
      ...scope,
      work_item_id: "w-1",
      question: "Q2?",
      chosen: "B",
      alternatives: [],
      rationale_md: "Because2",
      input_artifact_ids: [],
      created_at: "2026-02-27T00:00:01Z",
    };

    const decisionsInserted = upsertWorkDecision([decision1], decision2);
    expect(decisionsInserted.map((d) => d.decision_id)).toEqual(["d-2", "d-1"]);

    const signal1: WorkSignal = {
      signal_id: "s-1",
      ...scope,
      work_item_id: "w-1",
      trigger_kind: "time",
      trigger_spec_json: { at: "tomorrow" },
      status: "active",
      created_at: "2026-02-27T00:00:00Z",
      last_fired_at: null,
    };
    const signal2: WorkSignal = {
      signal_id: "s-2",
      ...scope,
      work_item_id: "w-1",
      trigger_kind: "event",
      trigger_spec_json: { when: "approval_resolved" },
      status: "active",
      created_at: "2026-02-27T00:00:01Z",
      last_fired_at: null,
    };

    const signalsInserted = upsertWorkSignal([signal1], signal2);
    expect(signalsInserted.map((s) => s.signal_id)).toEqual(["s-2", "s-1"]);

    const kv1: AgentStateKVEntry = {
      ...scope,
      key: "prefs.timezone",
      value_json: "UTC",
      updated_at: "2026-02-27T00:00:00Z",
    };
    const kv2: AgentStateKVEntry = {
      ...scope,
      key: "prefs.timezone",
      value_json: "America/Los_Angeles",
      updated_at: "2026-02-27T00:00:01Z",
    };

    const kvUpdated = upsertWorkStateKvEntry([kv1], kv2);
    expect(kvUpdated).toHaveLength(1);
    expect(kvUpdated[0]?.value_json).toBe("America/Los_Angeles");
  });

  it("selects tasks for the selected work item with a stable empty fallback", async () => {
    const store: any = await import("../src/renderer/lib/workboard-store.js");
    expect(typeof store.selectTasksForSelectedWorkItem).toBe("function");

    const task: WorkTaskSummary = {
      task_id: "t-1",
      status: "running",
      last_event_at: "2026-02-27T00:00:00Z",
    };

    const populated: WorkTasksByWorkItemId = { "w-1": { "t-1": task } };

    expect(store.selectTasksForSelectedWorkItem(populated, null)).toBe(
      store.selectTasksForSelectedWorkItem(populated, null),
    );

    expect(store.selectTasksForSelectedWorkItem({}, "w-missing")).toBe(
      store.selectTasksForSelectedWorkItem(populated, "w-missing"),
    );

    expect(store.selectTasksForSelectedWorkItem(populated, "w-1")).toBe(populated["w-1"]);
  });

  it("skips KV update processing when drilldown is not selected", async () => {
    const store: any = await import("../src/renderer/lib/workboard-store.js");
    expect(typeof store.shouldProcessWorkStateKvUpdate).toBe("function");

    const agentScope: WorkStateKVScope = { kind: "agent", ...scope };
    const workItemScope: WorkStateKVScope = { kind: "work_item", ...scope, work_item_id: "w-1" };

    expect(store.shouldProcessWorkStateKvUpdate(agentScope, null)).toBe(false);
    expect(store.shouldProcessWorkStateKvUpdate(workItemScope, null)).toBe(false);
    expect(store.shouldProcessWorkStateKvUpdate(workItemScope, "w-2")).toBe(false);

    expect(store.shouldProcessWorkStateKvUpdate(agentScope, "w-1")).toBe(true);
    expect(store.shouldProcessWorkStateKvUpdate(workItemScope, "w-1")).toBe(true);
  });
});
