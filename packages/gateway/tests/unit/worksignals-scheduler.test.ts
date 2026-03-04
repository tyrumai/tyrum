import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { WorkSignalScheduler } from "../../src/modules/workboard/signal-scheduler.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: 1,
  };
}

describe("WorkSignalScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rolls back if it loses the firing lease mid-transaction", async () => {
    const cm = new ConnectionManager();
    const db = openTestSqliteDb();
    try {
      const dal = new WorkboardDal(db);
      const scope = {
        tenant_id: DEFAULT_TENANT_ID,
        agent_id: DEFAULT_AGENT_ID,
        workspace_id: DEFAULT_WORKSPACE_ID,
      } as const;

      const item = await dal.createItem({
        scope,
        item: { kind: "action", title: "Hello" },
        createdFromSessionKey: "agent:default:main",
      });

      const signal = await dal.createSignal({
        scope,
        signal: {
          work_item_id: item.work_item_id,
          trigger_kind: "event",
          trigger_spec_json: { kind: "work_item.status.transition", to: ["blocked"] },
        },
      });

      await dal.transitionItem({ scope, work_item_id: item.work_item_id, status: "ready" });
      await dal.transitionItem({ scope, work_item_id: item.work_item_id, status: "doing" });
      await dal.transitionItem({ scope, work_item_id: item.work_item_id, status: "blocked" });

      const originalRun = db.run.bind(db);
      db.run = (async (sql: string, params: readonly unknown[] = []) => {
        if (
          typeof sql === "string" &&
          sql.includes("UPDATE work_signal_firings") &&
          sql.includes("SET status = 'enqueued'")
        ) {
          // Simulate losing the lease by making the final UPDATE not apply.
          return { changes: 0 };
        }
        return await originalRun(sql, params);
      }) as typeof db.run;

      const scheduler = new WorkSignalScheduler({
        db,
        connectionManager: cm,
        owner: "test",
      });
      await scheduler.tick();

      const updated = await dal.getSignal({ scope, signal_id: signal.signal_id });
      expect(updated?.status).toBe("active");

      const tasks = await db.all<{ task_id: string }>(
        "SELECT task_id FROM work_item_tasks WHERE tenant_id = ? AND work_item_id = ?",
        [scope.tenant_id, item.work_item_id],
      );
      expect(tasks).toHaveLength(0);
    } finally {
      await db.close();
    }
  });

  it("pauses a signal when its firing permanently fails", async () => {
    const cm = new ConnectionManager();
    const db = openTestSqliteDb();
    try {
      const dal = new WorkboardDal(db);
      const scope = {
        tenant_id: DEFAULT_TENANT_ID,
        agent_id: DEFAULT_AGENT_ID,
        workspace_id: DEFAULT_WORKSPACE_ID,
      } as const;

      const item = await dal.createItem({
        scope,
        item: { kind: "action", title: "Hello" },
        createdFromSessionKey: "agent:default:main",
      });

      const signal = await dal.createSignal({
        scope,
        signal: {
          work_item_id: item.work_item_id,
          trigger_kind: "event",
          trigger_spec_json: { kind: "work_item.status.transition", to: ["blocked"] },
        },
      });

      await dal.transitionItem({ scope, work_item_id: item.work_item_id, status: "ready" });
      await dal.transitionItem({ scope, work_item_id: item.work_item_id, status: "doing" });
      await dal.transitionItem({ scope, work_item_id: item.work_item_id, status: "blocked" });

      const originalGet = db.get.bind(db);
      db.get = (async <T>(sql: string, params: readonly unknown[] = []) => {
        if (typeof sql === "string" && sql.includes("UPDATE work_signals")) {
          throw new Error("boom");
        }
        return await originalGet<T>(sql, params);
      }) as typeof db.get;

      const scheduler = new WorkSignalScheduler({
        db,
        connectionManager: cm,
        owner: "test",
        maxAttempts: 1,
      });
      await scheduler.tick();

      const firings = await db.all<{ status: string }>(
        "SELECT status FROM work_signal_firings WHERE tenant_id = ? AND signal_id = ?",
        [scope.tenant_id, signal.signal_id],
      );
      expect(firings).toHaveLength(1);
      expect(firings[0]?.status).toBe("failed");

      const updated = await dal.getSignal({ scope, signal_id: signal.signal_id });
      expect(updated?.status).toBe("paused");

      const tasks = await db.all<{ task_id: string }>(
        "SELECT task_id FROM work_item_tasks WHERE tenant_id = ? AND work_item_id = ?",
        [scope.tenant_id, item.work_item_id],
      );
      expect(tasks).toHaveLength(0);
    } finally {
      await db.close();
    }
  });

  it("fires event-based WorkSignals on work item status transitions (deduped across restarts)", async () => {
    const cm = new ConnectionManager();
    const ws = createMockWs();
    cm.addClient(
      ws as never,
      [] as never,
      {
        role: "client",
        authClaims: {
          token_kind: "admin",
          role: "admin",
          scopes: ["*"],
        },
      } as never,
    );

    const db = openTestSqliteDb();
    try {
      const dal = new WorkboardDal(db);
      const scope = {
        tenant_id: DEFAULT_TENANT_ID,
        agent_id: DEFAULT_AGENT_ID,
        workspace_id: DEFAULT_WORKSPACE_ID,
      } as const;

      const item = await dal.createItem({
        scope,
        item: { kind: "action", title: "Hello" },
        createdFromSessionKey: "agent:default:main",
      });

      const signal = await dal.createSignal({
        scope,
        signal: {
          work_item_id: item.work_item_id,
          trigger_kind: "event",
          trigger_spec_json: { kind: "work_item.status.transition", to: ["blocked"] },
          payload_json: { reason: "notify" },
        },
      });

      await dal.transitionItem({ scope, work_item_id: item.work_item_id, status: "ready" });
      await dal.transitionItem({ scope, work_item_id: item.work_item_id, status: "doing" });
      await dal.transitionItem({ scope, work_item_id: item.work_item_id, status: "blocked" });

      const scheduler = new WorkSignalScheduler({
        db,
        connectionManager: cm,
        owner: "test",
      });
      await scheduler.tick();

      const firedMessages = ws.send.mock.calls
        .map((c) => {
          try {
            return JSON.parse(String(c[0]));
          } catch {
            return undefined;
          }
        })
        .filter((m) => m && typeof m === "object" && m.type === "work.signal.fired");

      expect(firedMessages).toHaveLength(1);
      expect(firedMessages[0]?.payload?.signal_id).toBe(signal.signal_id);

      const updated = await dal.getSignal({ scope, signal_id: signal.signal_id });
      expect(updated?.status).toBe("fired");
      expect(typeof updated?.last_fired_at).toBe("string");

      ws.send.mockClear();
      const restarted = new WorkSignalScheduler({ db, connectionManager: cm, owner: "test-2" });
      await restarted.tick();
      expect(ws.send).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });
});
