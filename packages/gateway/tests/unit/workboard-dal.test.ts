import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("rejects cross-scope parent_work_item_id", async () => {
    const dal = createDal();
    const scopeA = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;
    const scopeB = { tenant_id: "default", agent_id: "agent-b", workspace_id: "default" } as const;

    const foreignParent = await dal.createItem({
      scope: scopeB,
      item: {
        kind: "action",
        title: "Foreign parent",
        created_from_session_key: "agent:agent-b:main",
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    await expect(
      dal.createItem({
        scope: scopeA,
        item: {
          kind: "action",
          title: "Child",
          parent_work_item_id: foreignParent.work_item_id,
          created_from_session_key: "agent:default:main",
        },
        createdAtIso: "2026-02-27T00:00:01.000Z",
      }),
    ).rejects.toThrow(/scope/i);
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
      status: "ready",
      occurredAtIso: "2026-02-27T00:00:02.000Z",
      reason: "triage",
    });

    await dal.transitionItem({
      scope,
      work_item_id: b.work_item_id,
      status: "doing",
      occurredAtIso: "2026-02-27T00:00:03.000Z",
      reason: "start",
    });

    const events = await dal.listEvents({ scope, work_item_id: b.work_item_id });
    expect(events.events[0]!.kind).toBe("status.transition");

    const all = await dal.listItems({ scope });
    expect(all.items.map((it) => it.work_item_id)).toEqual([b.work_item_id, a.work_item_id]);

    const doing = await dal.listItems({ scope, statuses: ["doing"] });
    expect(doing.items.map((it) => it.work_item_id)).toEqual([b.work_item_id]);
  });

  it("rejects invalid work item transitions", async () => {
    const dal = createDal();
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const item = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Bad transition",
        created_from_session_key: "agent:default:main",
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    await expect(
      dal.transitionItem({
        scope,
        work_item_id: item.work_item_id,
        status: "doing",
        occurredAtIso: "2026-02-27T00:00:01.000Z",
      }),
    ).rejects.toMatchObject({
      code: "invalid_transition",
      details: { from: "backlog", to: "doing" },
    });
  });

  it("paginates work item lists with cursor", async () => {
    const dal = createDal();
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const one = await dal.createItem({
      scope,
      item: { kind: "action", title: "1", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });
    const two = await dal.createItem({
      scope,
      item: { kind: "action", title: "2", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });
    const three = await dal.createItem({
      scope,
      item: { kind: "action", title: "3", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:02.000Z",
    });

    const page1 = await dal.listItems({ scope, limit: 2 });
    expect(page1.items.map((i) => i.work_item_id)).toEqual([three.work_item_id, two.work_item_id]);
    expect(page1.next_cursor).toBeTruthy();

    const page2 = await dal.listItems({ scope, limit: 2, cursor: page1.next_cursor });
    expect(page2.items.map((i) => i.work_item_id)).toEqual([one.work_item_id]);
    expect(page2.next_cursor).toBeUndefined();
  });

  it("enforces WIP limit when claiming work items", async () => {
    const dal = createDal();
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const [first, second, third] = await Promise.all([
      dal.createItem({
        scope,
        item: { kind: "action", title: "Item 1", created_from_session_key: "agent:default:main" },
        createdAtIso: "2026-02-27T00:00:00.000Z",
      }),
      dal.createItem({
        scope,
        item: { kind: "action", title: "Item 2", created_from_session_key: "agent:default:main" },
        createdAtIso: "2026-02-27T00:00:01.000Z",
      }),
      dal.createItem({
        scope,
        item: { kind: "action", title: "Item 3", created_from_session_key: "agent:default:main" },
        createdAtIso: "2026-02-27T00:00:02.000Z",
      }),
    ]);

    await dal.transitionItem({
      scope,
      work_item_id: first.work_item_id,
      status: "ready",
      occurredAtIso: "2026-02-27T00:00:03.000Z",
    });
    await dal.transitionItem({
      scope,
      work_item_id: second.work_item_id,
      status: "ready",
      occurredAtIso: "2026-02-27T00:00:03.000Z",
    });
    await dal.transitionItem({
      scope,
      work_item_id: third.work_item_id,
      status: "ready",
      occurredAtIso: "2026-02-27T00:00:03.000Z",
    });

    await dal.transitionItem({
      scope,
      work_item_id: first.work_item_id,
      status: "doing",
      occurredAtIso: "2026-02-27T00:00:04.000Z",
    });
    await dal.transitionItem({
      scope,
      work_item_id: second.work_item_id,
      status: "doing",
      occurredAtIso: "2026-02-27T00:00:04.001Z",
    });

    await expect(
      dal.transitionItem({
        scope,
        work_item_id: third.work_item_id,
        status: "doing",
        occurredAtIso: "2026-02-27T00:00:04.002Z",
      }),
    ).rejects.toMatchObject({
      code: "wip_limit_exceeded",
      details: { limit: 2 },
    });
  });

  it("normalizes advisory lock seeds to signed 32-bit integers", async () => {
    const lockSeeds: number[] = [];

    const tx = {
      kind: "postgres" as const,
      get: vi.fn(async (sql: string, _params: unknown[] = []) => {
        if (sql.includes("SELECT *")) {
          return {
            work_item_id: "item-1",
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            kind: "action",
            title: "Seed test",
            status: "ready",
            priority: 0,
            acceptance_json: null,
            fingerprint_json: null,
            budgets_json: null,
            created_from_session_key: "agent:default:main",
            created_at: "2026-02-27T00:00:00.000Z",
            updated_at: "2026-02-27T00:00:00.000Z",
            last_active_at: null,
            parent_work_item_id: null,
          };
        }

        if (sql.includes("pg_advisory_xact_lock")) {
          if (_params.length >= 2) {
            const [tenantSeed, workspaceSeed] = _params as [number, number];
            lockSeeds.push(tenantSeed, workspaceSeed);
          }
          return { lock: true };
        }

        if (sql.includes("SELECT COUNT(*) AS count")) {
          return { count: 0 };
        }

        if (sql.includes("UPDATE work_items")) {
          return {
            work_item_id: "item-1",
            tenant_id: "default",
            agent_id: "default",
            workspace_id: "default",
            kind: "action",
            title: "Seed test",
            status: "doing",
            priority: 0,
            acceptance_json: null,
            fingerprint_json: null,
            budgets_json: null,
            created_from_session_key: "agent:default:main",
            created_at: "2026-02-27T00:00:00.000Z",
            updated_at: "2026-02-27T00:00:00.000Z",
            last_active_at: null,
            parent_work_item_id: null,
          };
        }

        return undefined;
      }),
      run: vi.fn(async () => ({ changes: 1 })),
      all: vi.fn(async () => []),
      exec: vi.fn(async () => {}),
      transaction: vi.fn(async (fn: (value: unknown) => Promise<unknown>) => fn(tx)),
      close: vi.fn(async () => {}),
    };

    const dal = new WorkboardDal(tx);
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    await dal.transitionItem({
      scope,
      work_item_id: "item-1",
      status: "doing",
      occurredAtIso: "2026-02-27T00:00:00.000Z",
    });

    expect(lockSeeds).toHaveLength(2);
    expect(lockSeeds[0]).toBe(-673531093);
    expect(lockSeeds[1]).toBe(-1824826402);
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

  it("escapes SQL LIKE wildcards in KV prefix search", async () => {
    const dal = createDal();
    const scope = {
      kind: "agent",
      tenant_id: "default",
      agent_id: "default",
      workspace_id: "default",
    } as const;

    await dal.setStateKv({
      scope,
      key: "config_foo",
      value_json: { ok: true },
      updatedAtIso: "2026-02-27T00:00:00.000Z",
    });
    await dal.setStateKv({
      scope,
      key: "configXfoo",
      value_json: { ok: false },
      updatedAtIso: "2026-02-27T00:00:00.000Z",
    });

    await dal.setStateKv({
      scope,
      key: "pct%foo",
      value_json: { ok: true },
      updatedAtIso: "2026-02-27T00:00:00.000Z",
    });
    await dal.setStateKv({
      scope,
      key: "pctAfoo",
      value_json: { ok: false },
      updatedAtIso: "2026-02-27T00:00:00.000Z",
    });

    const underscore = await dal.listStateKv({ scope, prefix: "config_" });
    expect(underscore.entries.map((e) => e.key)).toEqual(["config_foo"]);

    const percent = await dal.listStateKv({ scope, prefix: "pct%" });
    expect(percent.entries.map((e) => e.key)).toEqual(["pct%foo"]);
  });

  it("rejects setting work item state KV outside the caller scope", async () => {
    const dal = createDal();

    const scopeA = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;
    const scopeB = { tenant_id: "default", agent_id: "agent-b", workspace_id: "default" } as const;

    const foreignItem = await dal.createItem({
      scope: scopeB,
      item: { kind: "action", title: "Foreign", created_from_session_key: "agent:agent-b:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    await expect(
      dal.setStateKv({
        scope: {
          kind: "work_item",
          tenant_id: scopeA.tenant_id,
          agent_id: scopeA.agent_id,
          workspace_id: scopeA.workspace_id,
          work_item_id: foreignItem.work_item_id,
        },
        key: "branch",
        value_json: { name: "should-fail" },
        updatedAtIso: "2026-02-27T00:00:00.000Z",
      }),
    ).rejects.toThrow(/scope/i);
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

  it("rejects attaching artifacts outside the caller scope", async () => {
    const dal = createDal();
    const scopeA = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;
    const scopeB = { tenant_id: "default", agent_id: "agent-b", workspace_id: "default" } as const;

    const foreignItem = await dal.createItem({
      scope: scopeB,
      item: { kind: "action", title: "Foreign", created_from_session_key: "agent:agent-b:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    await expect(
      dal.createArtifact({
        scope: scopeA,
        artifact: {
          work_item_id: foreignItem.work_item_id,
          kind: "risk",
          title: "Should fail",
        },
        createdAtIso: "2026-02-27T00:00:00.000Z",
      }),
    ).rejects.toThrow(/scope/i);
  });

  it("rejects created_by_subagent_id outside the caller scope", async () => {
    const dal = createDal();
    const scopeA = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;
    const scopeB = { tenant_id: "default", agent_id: "agent-b", workspace_id: "default" } as const;

    const foreignItem = await dal.createItem({
      scope: scopeB,
      item: { kind: "action", title: "Foreign", created_from_session_key: "agent:agent-b:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const foreignSubagentId = "00000000-0000-0000-0000-000000000099";
    const foreignSubagent = await dal.createSubagent({
      scope: scopeB,
      subagent: {
        execution_profile: "executor",
        session_key: `agent:agent-b:subagent:${foreignSubagentId}`,
        work_item_id: foreignItem.work_item_id,
      },
      subagentId: foreignSubagentId,
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });

    await expect(
      dal.createArtifact({
        scope: scopeA,
        artifact: {
          kind: "risk",
          title: "Should fail",
          created_by_subagent_id: foreignSubagent.subagent_id,
        },
        createdAtIso: "2026-02-27T00:00:02.000Z",
      }),
    ).rejects.toThrow(/scope/i);

    await expect(
      dal.createDecision({
        scope: scopeA,
        decision: {
          question: "Should this be allowed?",
          chosen: "No",
          rationale_md: "Cross-scope references must be rejected.",
          created_by_subagent_id: foreignSubagent.subagent_id,
        },
        createdAtIso: "2026-02-27T00:00:03.000Z",
      }),
    ).rejects.toThrow(/scope/i);
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

    const other = await dal.createSignal({
      scope,
      signal: {
        trigger_kind: "event",
        trigger_spec_json: { on: "artifact.created" },
      },
      createdAtIso: "2026-02-27T00:00:00.500Z",
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
    expect(listed.signals.map((s) => s.signal_id)).toEqual([other.signal_id, signal.signal_id]);

    const pausedOnly = await dal.listSignals({ scope, statuses: ["paused"] });
    expect(pausedOnly.signals.map((s) => s.signal_id)).toEqual([signal.signal_id]);
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
    const dal = createDal();
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const subagentId = "00000000-0000-0000-0000-000000000123";
    const created = await dal.createSubagent({
      scope,
      subagent: {
        execution_profile: "executor",
        session_key: `agent:default:subagent:${subagentId}`,
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

  it("rejects cross-work-item task dependencies", async () => {
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

  it("rejects task dependency cycles", async () => {
    const dal = createDal();
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const item = await dal.createItem({
      scope,
      item: { kind: "action", title: "Cycle", created_from_session_key: "agent:default:main" },
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

  it("leases runnable tasks respecting fan-out/fan-in dependencies", async () => {
    const dal = createDal();
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

    const item = await dal.createItem({
      scope,
      item: { kind: "action", title: "DAG", created_from_session_key: "agent:default:main" },
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
      patch: { status: "completed", finished_at: "2026-02-27T00:00:06.000Z" },
      updatedAtIso: "2026-02-27T00:00:06.000Z",
    });
    await dal.updateTask({
      scope,
      task_id: c.task_id,
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

  it("emits work.task.* WS events for task lifecycle", async () => {
    const dal = createDal();
    const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;

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
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, ?, ?)`,
      [jobId, "agent:default:main", "main", "queued", JSON.stringify({ kind: "manual" })],
    );
    await db!.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [runId, jobId, "agent:default:main", "main", "queued", 1],
    );

    await dal.updateTask({
      scope,
      task_id: task.task_id,
      patch: { status: "running", run_id: runId, started_at: "2026-02-27T00:00:02.000Z" },
      updatedAtIso: "2026-02-27T00:00:02.000Z",
    });

    const approval = await db!.get<{ id: number }>(
      `INSERT INTO approvals (plan_id, step_index, prompt)
       VALUES (?, ?, ?)
       RETURNING id`,
      ["plan-test", 0, "approve?"],
    );
    expect(approval).toBeDefined();

    await dal.updateTask({
      scope,
      task_id: task.task_id,
      patch: { status: "paused", approval_id: approval!.id },
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
    const workTaskEvents = outbox
      .filter((row) => row.topic === "ws.broadcast")
      .map((row) => JSON.parse(row.payload_json) as { message?: any })
      .map((row) => row.message)
      .filter((msg) => msg?.type?.startsWith("work.task."));

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
    expect(workTaskEvents[2]?.payload?.approval_id).toBe(approval!.id);
    expect(workTaskEvents[3]?.payload?.result_summary).toBe("ok");
  });
});
