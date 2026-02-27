import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";

describe("WorkboardDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createDal(): WorkboardDal {
    db = openTestSqliteDb();
    return new WorkboardDal(db);
  }

  it("creates and fetches a work item", async () => {
    const dal = createDal();
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const created = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Ship migrations + DAL",
        acceptance: { tests: "green" },
        created_from_session_key: "agent:default:main",
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    expect(created.work_item_id).toBeTruthy();
    expect(created.status).toBe("backlog");
    expect(created.priority).toBe(0);
    expect(created.acceptance).toEqual({ tests: "green" });
    expect(created.created_from_session_key).toBe("agent:default:main");
    expect(created.created_at).toBe("2026-02-27T00:00:00.000Z");

    const fetched = await dal.getItem({ scope, work_item_id: created.work_item_id });
    expect(fetched).toBeDefined();
    expect(fetched).toMatchObject({
      work_item_id: created.work_item_id,
      title: "Ship migrations + DAL",
      status: "backlog",
    });
  });

  it("lists work items by scope and status", async () => {
    const dal = createDal();
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const a = await dal.createItem({
      scope,
      item: { kind: "action", title: "A", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });
    const b = await dal.createItem({
      scope,
      item: { kind: "initiative", title: "B", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });

    await dal.transitionItem({
      scope,
      work_item_id: b.work_item_id,
      status: "doing",
      occurredAtIso: "2026-02-27T00:00:02.000Z",
      reason: "start",
    });

    const events = await dal.listEvents({ scope, work_item_id: b.work_item_id });
    expect(events.events[0]!.kind).toBe("status.transition");

    const all = await dal.listItems({ scope });
    expect(all.items.map((it) => it.work_item_id)).toEqual([b.work_item_id, a.work_item_id]);

    const doing = await dal.listItems({ scope, statuses: ["doing"] });
    expect(doing.items.map((it) => it.work_item_id)).toEqual([b.work_item_id]);
  });

  it("updates a work item", async () => {
    const dal = createDal();
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const created = await dal.createItem({
      scope,
      item: { kind: "action", title: "Old", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const updated = await dal.updateItem({
      scope,
      work_item_id: created.work_item_id,
      patch: {
        title: "New",
        priority: 3,
        budgets: null,
        last_active_at: "2026-02-27T00:01:00.000Z",
      },
      updatedAtIso: "2026-02-27T00:01:00.000Z",
    });

    expect(updated).toBeDefined();
    expect(updated!.title).toBe("New");
    expect(updated!.priority).toBe(3);
    expect(updated!.budgets).toBeNull();
    expect(updated!.last_active_at).toBe("2026-02-27T00:01:00.000Z");
  });

  it("sets and gets state KV (agent + work item scopes)", async () => {
    const dal = createDal();

    const agentScope = {
      kind: "agent",
      tenant_id: "default",
      agent_id: "default",
      workspace_id: "default",
    } as const;

    const agentEntry = await dal.setStateKv({
      scope: agentScope,
      key: "prefs.theme",
      value_json: { mode: "dark" },
      updatedAtIso: "2026-02-27T00:00:00.000Z",
    });
    expect(agentEntry.value_json).toEqual({ mode: "dark" });

    const agentFetched = await dal.getStateKv({ scope: agentScope, key: "prefs.theme" });
    expect(agentFetched).toMatchObject({ key: "prefs.theme", value_json: { mode: "dark" } });

    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;
    const item = await dal.createItem({
      scope,
      item: { kind: "action", title: "KV", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const workItemScope = {
      ...agentScope,
      kind: "work_item",
      work_item_id: item.work_item_id,
    } as const;
    const wiEntry = await dal.setStateKv({
      scope: workItemScope,
      key: "branch",
      value_json: { name: "600-workboard" },
      updatedAtIso: "2026-02-27T00:00:00.000Z",
    });
    expect(wiEntry.value_json).toEqual({ name: "600-workboard" });

    const listed = await dal.listStateKv({ scope: workItemScope, prefix: "br" });
    expect(listed.entries.map((e) => e.key)).toEqual(["branch"]);
  });

  it("creates and lists artifacts for a work item", async () => {
    const dal = createDal();
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const item = await dal.createItem({
      scope,
      item: { kind: "action", title: "Artifacts", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const artifact = await dal.createArtifact({
      scope,
      artifact: {
        work_item_id: item.work_item_id,
        kind: "candidate_plan",
        title: "Plan",
        body_md: "- step 1\n- step 2",
        refs: ["run:abc"],
        confidence: 0.9,
        provenance_json: { source: "test" },
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    expect(artifact.work_item_id).toBe(item.work_item_id);
    expect(artifact.refs).toEqual(["run:abc"]);

    const fetched = await dal.getArtifact({ scope, artifact_id: artifact.artifact_id });
    expect(fetched).toBeDefined();
    expect(fetched!.artifact_id).toBe(artifact.artifact_id);

    const listed = await dal.listArtifacts({ scope, work_item_id: item.work_item_id });
    expect(listed.artifacts.map((a) => a.artifact_id)).toEqual([artifact.artifact_id]);
  });

  it("creates and lists decision records", async () => {
    const dal = createDal();
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const item = await dal.createItem({
      scope,
      item: { kind: "action", title: "Decisions", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const decision = await dal.createDecision({
      scope,
      decision: {
        work_item_id: item.work_item_id,
        question: "Which approach?",
        chosen: "Keep it simple",
        alternatives: ["Over-engineer"],
        rationale_md: "Minimize moving parts.",
        input_artifact_ids: [],
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const fetched = await dal.getDecision({ scope, decision_id: decision.decision_id });
    expect(fetched).toBeDefined();
    expect(fetched).toMatchObject({ decision_id: decision.decision_id, chosen: "Keep it simple" });

    const listed = await dal.listDecisions({ scope, work_item_id: item.work_item_id });
    expect(listed.decisions.map((d) => d.decision_id)).toEqual([decision.decision_id]);
  });

  it("creates and updates a work signal", async () => {
    const dal = createDal();
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const signal = await dal.createSignal({
      scope,
      signal: {
        trigger_kind: "event",
        trigger_spec_json: { on: "approval.resolved" },
        payload_json: { notify: true },
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const updated = await dal.updateSignal({
      scope,
      signal_id: signal.signal_id,
      patch: { status: "paused" },
    });
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("paused");

    const fetched = await dal.getSignal({ scope, signal_id: signal.signal_id });
    expect(fetched).toBeDefined();
    expect(fetched!.status).toBe("paused");

    const listed = await dal.listSignals({ scope });
    expect(listed.signals.map((s) => s.signal_id)).toEqual([signal.signal_id]);
  });

  it("creates tasks, subagents, links, and scope activity", async () => {
    const dal = createDal();
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const a = await dal.createItem({
      scope,
      item: { kind: "action", title: "A", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });
    const b = await dal.createItem({
      scope,
      item: { kind: "action", title: "B", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });

    await dal.upsertScopeActivity({
      scope,
      last_active_session_key: "agent:default:main",
      updated_at_ms: 1_709_000_000_000,
    });
    const activity = await dal.getScopeActivity({ scope });
    expect(activity).toMatchObject({
      last_active_session_key: "agent:default:main",
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
        session_key: `agent:default:subagent:${subagentId}`,
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
  });
});
