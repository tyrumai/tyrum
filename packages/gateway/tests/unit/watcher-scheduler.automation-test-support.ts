import { expect, it, vi } from "vitest";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import {
  createAutomationScheduler,
  requireWatcherSchedulerContext,
  type WatcherSchedulerState,
  withAutomationEnabledEnv,
} from "./watcher-scheduler.test-support.js";

export function registerWatcherSchedulerAutomationTests(state: WatcherSchedulerState): void {
  it("preserves legacy interval-only periodic watchers so they fail visibly during processing", async () => {
    const context = requireWatcherSchedulerContext(state);
    const { db, processor } = context;
    const { enqueuedInputs, scheduler } = createAutomationScheduler(context);

    const id = await processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });
    await db.run(
      "UPDATE watchers SET trigger_config_json = ? WHERE tenant_id = ? AND watcher_id = ?",
      [JSON.stringify({ intervalMs: 1000 }), DEFAULT_TENANT_ID, id],
    );

    await scheduler.tick();

    expect(enqueuedInputs).toHaveLength(0);

    const firing = await db.get<{ status: string; error: string | null }>(
      "SELECT status, error FROM watcher_firings",
    );
    expect(firing).toBeDefined();
    expect(firing!.status).toBe("failed");
    expect(firing!.error).toMatch(/playbook .* not found/i);
  });

  it("includes firing + lease ids in the cron execution trigger metadata", async () => {
    await withAutomationEnabledEnv(async () => {
      const context = requireWatcherSchedulerContext(state);
      const { db, processor } = context;
      const { enqueuedInputs, scheduler } = createAutomationScheduler(context);

      await processor.createWatcher("plan-1", "periodic", {
        intervalMs: 1000,
        steps: [{ type: "CLI", args: { cmd: "echo", args: ["hi"] } }],
      });

      await scheduler.tick();

      expect(enqueuedInputs).toHaveLength(1);

      const firing = await db.get<{ watcher_firing_id: string }>(
        "SELECT watcher_firing_id FROM watcher_firings",
      );
      expect(firing).toBeDefined();
      expect(firing!.watcher_firing_id).toBeTypeOf("string");

      const trigger = enqueuedInputs[0]?.["trigger"] as Record<string, unknown> | undefined;
      expect(trigger).toBeDefined();
      expect(trigger?.["kind"]).toBe("cron");

      const metadata = trigger?.["metadata"] as Record<string, unknown> | undefined;
      expect(metadata?.["firing_id"]).toBe(firing!.watcher_firing_id);
      expect(metadata?.["lease_owner"]).toBe("scheduler-1");
      expect(typeof metadata?.["lease_expires_at_ms"]).toBe("number");
    });
  });

  it("uses heartbeat trigger kind when lane is heartbeat", async () => {
    await withAutomationEnabledEnv(async () => {
      const context = requireWatcherSchedulerContext(state);
      const { processor } = context;
      const { enqueuedInputs, scheduler } = createAutomationScheduler(context);

      await processor.createWatcher("plan-1", "periodic", {
        intervalMs: 1000,
        key: "agent:default:main",
        lane: "heartbeat",
        steps: [{ type: "CLI", args: { cmd: "echo", args: ["hi"] } }],
      });

      await scheduler.tick();

      expect(enqueuedInputs).toHaveLength(1);
      const trigger = enqueuedInputs[0]?.["trigger"] as Record<string, unknown> | undefined;
      expect(trigger).toBeDefined();
      expect(trigger?.["kind"]).toBe("heartbeat");
      expect(trigger?.["lane"]).toBe("heartbeat");
    });
  });

  it("enqueues a Decide step for heartbeat agent_turn schedules", async () => {
    const context = requireWatcherSchedulerContext(state);
    const { processor } = context;
    const { enqueuedInputs, scheduler } = createAutomationScheduler(context);

    await processor.createWatcher("plan-1", "periodic", {
      v: 1,
      schedule_kind: "heartbeat",
      enabled: true,
      cadence: { type: "interval", interval_ms: 1000 },
      execution: {
        kind: "agent_turn",
        instruction: "Review signals and act only if useful.",
      },
      delivery: { mode: "quiet" },
    });

    await scheduler.tick();

    expect(enqueuedInputs).toHaveLength(1);
    expect(enqueuedInputs[0]?.["lane"]).toBe("heartbeat");
    const steps = enqueuedInputs[0]?.["steps"] as Array<{
      type: string;
      args: Record<string, unknown>;
    }>;
    expect(steps).toHaveLength(1);
    expect(steps[0]!.type).toBe("Decide");
    expect(steps[0]!.args["channel"]).toBe("automation:default");
    expect(steps[0]!.args["thread_id"]).toBeTypeOf("string");
    expect((steps[0]!.args["metadata"] as Record<string, unknown>)["automation"]).toBeDefined();
  });

  it("fails closed when watcher scope keys cannot be resolved", async () => {
    const context = requireWatcherSchedulerContext(state);
    const { db, processor } = context;
    const { enqueuedInputs, scheduler } = createAutomationScheduler(context);
    const dbGet = db.get.bind(db);
    const getSpy = vi.spyOn(db, "get").mockImplementation(async (sql, params = []) => {
      if (sql.includes("SELECT t.tenant_key, ws.workspace_key, ag.agent_key")) {
        return undefined;
      }
      return dbGet(sql, params);
    });

    try {
      await processor.createWatcher("plan-1", "periodic", {
        v: 1,
        schedule_kind: "heartbeat",
        enabled: true,
        cadence: { type: "interval", interval_ms: 1000 },
        execution: {
          kind: "agent_turn",
          instruction: "Review signals and act only if useful.",
        },
        delivery: { mode: "quiet" },
      });

      await scheduler.tick();

      expect(enqueuedInputs).toHaveLength(0);

      const firing = await db.get<{ status: string; error: string | null }>(
        "SELECT status, error FROM watcher_firings",
      );
      expect(firing).toBeDefined();
      expect(firing!.status).toBe("failed");
      expect(firing!.error).toMatch(/failed to resolve watcher scope keys/i);
    } finally {
      getSpy.mockRestore();
    }
  });

  it("fails periodic automation when lane is invalid (does not silently reroute)", async () => {
    await withAutomationEnabledEnv(async () => {
      const context = requireWatcherSchedulerContext(state);
      const { db, processor } = context;
      const { enqueuedInputs, scheduler } = createAutomationScheduler(context);

      await processor.createWatcher("plan-1", "periodic", {
        intervalMs: 1000,
        lane: "custom-lane",
        steps: [{ type: "CLI", args: { cmd: "echo", args: ["hi"] } }],
      });

      await scheduler.tick();

      expect(enqueuedInputs).toHaveLength(0);

      const firing = await db.get<{ status: string; error: string | null }>(
        "SELECT status, error FROM watcher_firings",
      );
      expect(firing).toBeDefined();
      expect(firing!.status).toBe("failed");
      expect(firing!.error).toMatch(/invalid periodic watcher lane/i);
    });
  });
}
