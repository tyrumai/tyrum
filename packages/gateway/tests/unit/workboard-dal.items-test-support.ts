import { expect, it } from "vitest";
import type { WorkboardDalFixture } from "./workboard-dal.test-support.js";

export function registerItemsTests(fixture: WorkboardDalFixture): void {
  it("creates and fetches a work item", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

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
    const dal = fixture.createDal();
    const scopeA = await fixture.resolveScope();
    const scopeB = await fixture.resolveScope({ agentKey: "agent-b" });

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
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

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
    expect(all.items.map((item) => item.work_item_id)).toEqual([b.work_item_id, a.work_item_id]);

    const doing = await dal.listItems({ scope, statuses: ["doing"] });
    expect(doing.items.map((item) => item.work_item_id)).toEqual([b.work_item_id]);
  });

  it("rejects invalid work item transitions", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

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
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

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
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();
    const db = fixture.db();

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
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

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
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

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
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

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
}
