import { afterEach, describe, expect, it, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";

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

  async function resolveScope(input?: {
    tenantKey?: string;
    agentKey?: string;
    workspaceKey?: string;
  }): Promise<{ tenant_id: string; agent_id: string; workspace_id: string }> {
    if (!db) {
      throw new Error("db not initialized");
    }
    const identity = new IdentityScopeDal(db);
    const ids = await identity.resolveScopeIds(input);
    return { tenant_id: ids.tenantId, agent_id: ids.agentId, workspace_id: ids.workspaceId };
  }

  it("creates and fetches a work item", async () => {
    const dal = createDal();
    const scope = await resolveScope();

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
    const scopeA = await resolveScope();
    const scopeB = await resolveScope({ agentKey: "agent-b" });

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
    const scope = await resolveScope();

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
    const scope = await resolveScope();

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

  it("allows cancelling work items from ready and blocked", async () => {
    const dal = createDal();
    const scope = await resolveScope();

    const readyItem = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Cancel from ready",
        created_from_session_key: "agent:default:main",
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    await dal.transitionItem({
      scope,
      work_item_id: readyItem.work_item_id,
      status: "ready",
      occurredAtIso: "2026-02-27T00:00:01.000Z",
    });

    const cancelledFromReady = await dal.transitionItem({
      scope,
      work_item_id: readyItem.work_item_id,
      status: "cancelled",
      occurredAtIso: "2026-02-27T00:00:02.000Z",
      reason: "operator cancelled",
    });
    expect(cancelledFromReady).toBeDefined();
    expect(cancelledFromReady!.status).toBe("cancelled");

    const blockedItem = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Cancel from blocked",
        created_from_session_key: "agent:default:main",
      },
      createdAtIso: "2026-02-27T00:01:00.000Z",
    });

    await dal.transitionItem({
      scope,
      work_item_id: blockedItem.work_item_id,
      status: "ready",
      occurredAtIso: "2026-02-27T00:01:01.000Z",
    });
    await dal.transitionItem({
      scope,
      work_item_id: blockedItem.work_item_id,
      status: "doing",
      occurredAtIso: "2026-02-27T00:01:02.000Z",
    });
    await dal.transitionItem({
      scope,
      work_item_id: blockedItem.work_item_id,
      status: "blocked",
      occurredAtIso: "2026-02-27T00:01:03.000Z",
      reason: "waiting on approval",
    });

    const cancelledFromBlocked = await dal.transitionItem({
      scope,
      work_item_id: blockedItem.work_item_id,
      status: "cancelled",
      occurredAtIso: "2026-02-27T00:01:04.000Z",
    });
    expect(cancelledFromBlocked).toBeDefined();
    expect(cancelledFromBlocked!.status).toBe("cancelled");
  });

  it("cancels open tasks + closes subagents when work item is cancelled", async () => {
    const dal = createDal();
    const scope = await resolveScope();

    const terminalStatuses = ["cancelled", "done", "failed"] as const;
    const baseTimeMs = Date.parse("2026-02-27T00:00:00.000Z");

    for (const [idx, terminalStatus] of terminalStatuses.entries()) {
      const baseMs = baseTimeMs + idx * 60_000;
      const iso = (offsetMs: number): string => new Date(baseMs + offsetMs).toISOString();

      const item = await dal.createItem({
        scope,
        item: {
          kind: "action",
          title: `Terminal cleanup (${terminalStatus})`,
          created_from_session_key: "agent:default:main",
        },
        createdAtIso: iso(0),
      });

      await dal.transitionItem({
        scope,
        work_item_id: item.work_item_id,
        status: "ready",
        occurredAtIso: iso(1_000),
      });

      await dal.transitionItem({
        scope,
        work_item_id: item.work_item_id,
        status: "doing",
        occurredAtIso: iso(2_000),
      });

      const task = await dal.createTask({
        scope,
        task: {
          work_item_id: item.work_item_id,
          execution_profile: "executor",
          side_effect_class: "none",
        },
        createdAtIso: iso(3_000),
      });

      const leaseOwner = `test-owner-${terminalStatus}`;
      const nowMs = Date.parse(iso(4_000));
      await dal.leaseRunnableTasks({
        scope,
        work_item_id: item.work_item_id,
        lease_owner: leaseOwner,
        nowMs,
        leaseTtlMs: 60_000,
        limit: 10,
      });

      const leasedRow = await db!.get<{ status: string; lease_owner: string | null }>(
        `SELECT status, lease_owner
         FROM work_item_tasks
         WHERE task_id = ?`,
        [task.task_id],
      );
      expect(leasedRow).toBeDefined();
      expect(leasedRow!.status).toBe("leased");
      expect(leasedRow!.lease_owner).toBe(leaseOwner);

      const subagentId = `subagent-${terminalStatus}`;
      const subagent = await dal.createSubagent({
        scope,
        subagent: {
          execution_profile: "executor",
          session_key: `agent:default:subagent:${subagentId}`,
          work_item_id: item.work_item_id,
        },
        subagentId,
        createdAtIso: iso(5_000),
      });
      expect(subagent.status).toBe("running");

      const terminalAt = iso(6_000);
      await dal.transitionItem({
        scope,
        work_item_id: item.work_item_id,
        status: terminalStatus,
        reason: "operator terminal",
        occurredAtIso: terminalAt,
      });

      const cancelledTask = await db!.get<{
        status: string;
        lease_owner: string | null;
        lease_expires_at_ms: number | null;
        finished_at: string | null;
      }>(
        `SELECT status, lease_owner, lease_expires_at_ms, finished_at
         FROM work_item_tasks
         WHERE task_id = ?`,
        [task.task_id],
      );
      expect(cancelledTask).toBeDefined();
      expect(cancelledTask!.status).toBe("cancelled");
      expect(cancelledTask!.lease_owner).toBe(null);
      expect(cancelledTask!.lease_expires_at_ms).toBe(null);
      expect(cancelledTask!.finished_at).toBe(terminalAt);

      const cancelledSubagent = await db!.get<{ status: string; closed_at: string | null }>(
        `SELECT status, closed_at
         FROM subagents
         WHERE subagent_id = ?`,
        [subagent.subagent_id],
      );
      expect(cancelledSubagent).toBeDefined();
      expect(cancelledSubagent!.status).toBe("closed");
      expect(cancelledSubagent!.closed_at).toBe(terminalAt);

      const interrupt = await db!.get<{ kind: string }>(
        `SELECT kind
         FROM lane_queue_signals
         WHERE key = ? AND lane = ?`,
        [subagent.session_key, subagent.lane],
      );
      expect(interrupt).toBeDefined();
      expect(interrupt!.kind).toBe("interrupt");
    }
  });

  it("rejects new tasks/subagents and leases for terminal work items", async () => {
    const dal = createDal();
    const scope = await resolveScope();

    const terminalStatuses = ["cancelled", "done", "failed"] as const;
    const baseTimeMs = Date.parse("2026-02-27T01:00:00.000Z");

    for (const [idx, terminalStatus] of terminalStatuses.entries()) {
      const baseMs = baseTimeMs + idx * 60_000;
      const iso = (offsetMs: number): string => new Date(baseMs + offsetMs).toISOString();

      const item = await dal.createItem({
        scope,
        item: {
          kind: "action",
          title: `Terminal rejects (${terminalStatus})`,
          created_from_session_key: "agent:default:main",
        },
        createdAtIso: iso(0),
      });

      await dal.transitionItem({
        scope,
        work_item_id: item.work_item_id,
        status: "ready",
        occurredAtIso: iso(1_000),
      });

      await dal.transitionItem({
        scope,
        work_item_id: item.work_item_id,
        status: "doing",
        occurredAtIso: iso(2_000),
      });

      const task = await dal.createTask({
        scope,
        task: {
          work_item_id: item.work_item_id,
          execution_profile: "executor",
          side_effect_class: "none",
        },
        createdAtIso: iso(3_000),
      });

      await dal.transitionItem({
        scope,
        work_item_id: item.work_item_id,
        status: terminalStatus,
        occurredAtIso: iso(4_000),
      });

      await expect(
        dal.createTask({
          scope,
          task: {
            work_item_id: item.work_item_id,
            execution_profile: "executor",
            side_effect_class: "none",
          },
          createdAtIso: iso(5_000),
        }),
      ).rejects.toThrow(/terminal/i);

      await expect(
        dal.createSubagent({
          scope,
          subagent: {
            execution_profile: "executor",
            session_key: `agent:default:subagent:terminal-explicit-${terminalStatus}`,
            work_item_id: item.work_item_id,
          },
          subagentId: `terminal-explicit-${terminalStatus}`,
          createdAtIso: iso(6_000),
        }),
      ).rejects.toThrow(/terminal/i);

      await expect(
        dal.createSubagent({
          scope,
          subagent: {
            execution_profile: "executor",
            session_key: `agent:default:subagent:terminal-task-${terminalStatus}`,
            work_item_task_id: task.task_id,
          },
          subagentId: `terminal-task-${terminalStatus}`,
          createdAtIso: iso(7_000),
        }),
      ).rejects.toThrow(/terminal/i);

      await expect(
        dal.leaseRunnableTasks({
          scope,
          work_item_id: item.work_item_id,
          lease_owner: `lease-owner-${terminalStatus}`,
          nowMs: Date.parse(iso(8_000)),
          leaseTtlMs: 60_000,
          limit: 10,
        }),
      ).rejects.toThrow(/terminal/i);
    }
  });

  it("paginates work item lists with cursor", async () => {
    const dal = createDal();
    const scope = await resolveScope();

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
    const scope = await resolveScope();

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
            tenant_id: DEFAULT_TENANT_ID,
            agent_id: DEFAULT_AGENT_ID,
            workspace_id: DEFAULT_WORKSPACE_ID,
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
            tenant_id: DEFAULT_TENANT_ID,
            agent_id: DEFAULT_AGENT_ID,
            workspace_id: DEFAULT_WORKSPACE_ID,
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
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;

    await dal.transitionItem({
      scope,
      work_item_id: "item-1",
      status: "doing",
      occurredAtIso: "2026-02-27T00:00:00.000Z",
    });

    expect(lockSeeds).toHaveLength(2);
    expect(lockSeeds[0]).toBe(-1910563556);
    expect(lockSeeds[1]).toBe(-848283012);
  });

  it("updates a work item", async () => {
    const dal = createDal();
    const scope = await resolveScope();

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

    const baseScope = await resolveScope();
    const agentScope = {
      kind: "agent",
      ...baseScope,
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

    const scope = baseScope;
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
    const baseScope = await resolveScope();
    const scope = {
      kind: "agent",
      ...baseScope,
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

    const scopeA = await resolveScope();
    const scopeB = await resolveScope({ agentKey: "agent-b" });

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
    const scope = await resolveScope();

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
    const scopeA = await resolveScope();
    const scopeB = await resolveScope({ agentKey: "agent-b" });

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
    const scopeA = await resolveScope();
    const scopeB = await resolveScope({ agentKey: "agent-b" });

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
    const scope = await resolveScope();

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
    const scope = await resolveScope();

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
    const scope = await resolveScope();

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
    const scope = await resolveScope();

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
    const scope = await resolveScope();

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

  it("rejects depends_on task ids that do not exist", async () => {
    const dal = createDal();
    const scope = await resolveScope();

    const item = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Missing depends_on",
        created_from_session_key: "agent:default:main",
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
    const dal = createDal();
    const scope = await resolveScope();

    const item = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Self depends_on",
        created_from_session_key: "agent:default:main",
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

  it("rejects task dependency cycles", async () => {
    const dal = createDal();
    const scope = await resolveScope();

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

  it("normalizes task depends_on entries on read", async () => {
    const dal = createDal();
    const scope = await resolveScope();

    const item = await dal.createItem({
      scope,
      item: {
        kind: "action",
        title: "Read normalization",
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
         run_id,
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
    const dal = createDal();
    const scope = await resolveScope();

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

  it("leases tasks when dependencies are 'failed'", async () => {
    const dal = createDal();
    const scope = await resolveScope();

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
    const dal = createDal();
    const scope = await resolveScope();

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
    const dal = createDal();
    const scope = await resolveScope();

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

  it("enforces lease owner + expiry when leaving 'leased'", async () => {
    const dal = createDal();
    const scope = await resolveScope();

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
    const dal = createDal();
    const scope = await resolveScope();

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
      `INSERT INTO approvals (tenant_id, approval_id, approval_key, agent_id, workspace_id, kind, status, prompt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING approval_id`,
      [
        scope.tenant_id,
        "00000000-0000-4000-8000-000000000900",
        "approval:test",
        scope.agent_id,
        scope.workspace_id,
        "other",
        "pending",
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
});
