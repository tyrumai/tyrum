import { expect, it, vi } from "vitest";
import { PolicyService } from "@tyrum/runtime-policy";
import { buildAgentConversationKey } from "@tyrum/contracts";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";
import { PolicyBundleConfigDal } from "../../src/modules/policy/config-dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { createGatewayConfigStore } from "../../src/modules/runtime-state/gateway-config-store.js";
import {
  buildHeartbeatConversationKey,
  buildScheduleConversationKey,
} from "../../src/modules/automation/conversation-routing.js";
import {
  createAutomationScheduler,
  requireWatcherSchedulerContext,
  type WatcherSchedulerState,
  withAutomationEnabledEnv,
} from "./watcher-scheduler.test-support.js";

function cronStepsSchedule(intervalMs: number, steps: ReadonlyArray<Record<string, unknown>>) {
  return {
    v: 1,
    schedule_kind: "cron",
    enabled: true,
    cadence: { type: "interval", interval_ms: intervalMs },
    execution: { kind: "steps", steps },
    delivery: { mode: "notify" },
  } as const;
}

function heartbeatSchedule(input?: { instruction?: string; key?: string }) {
  return {
    v: 1,
    schedule_kind: "heartbeat",
    enabled: true,
    cadence: { type: "interval", interval_ms: 1000 },
    execution: {
      kind: "agent_turn",
      ...(input?.instruction ? { instruction: input.instruction } : undefined),
    },
    delivery: { mode: "quiet" },
    ...(input?.key ? { key: input.key } : undefined),
  } as const;
}

export function registerWatcherSchedulerAutomationTests(state: WatcherSchedulerState): void {
  it("skips legacy interval-only periodic watchers as invalid config", async () => {
    const context = requireWatcherSchedulerContext(state);
    const { db, processor } = context;
    const { enqueuedInputs, scheduler } = createAutomationScheduler(context);

    const id = await processor.createWatcher("plan-1", "periodic", { intervalMs: 1000 });

    await scheduler.tick();

    expect(enqueuedInputs).toHaveLength(0);
    const firingCount = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM watcher_firings WHERE tenant_id = ? AND watcher_id = ?",
      [DEFAULT_TENANT_ID, id],
    );
    expect(firingCount?.count).toBe(0);
  });

  it("includes firing + lease ids in the cron execution trigger metadata", async () => {
    await withAutomationEnabledEnv(async () => {
      const context = requireWatcherSchedulerContext(state);
      const { db, processor } = context;
      const { enqueuedInputs, scheduler } = createAutomationScheduler(context);

      await processor.createWatcher(
        "plan-1",
        "periodic",
        cronStepsSchedule(1000, [{ type: "Desktop", args: { op: "screenshot" } }]),
      );

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

  it("builds automation snapshots with the watcher agent scope", async () => {
    const context = requireWatcherSchedulerContext(state);
    const { db, processor } = context;
    const identityScopeDal = new IdentityScopeDal(db);
    const defaultAgentId = await identityScopeDal.ensureAgentId(DEFAULT_TENANT_ID, "default");
    const policyBundles = new PolicyBundleConfigDal(db);
    const policySnapshotDal = new PolicySnapshotDal(db);
    const policyOverrideDal = new PolicyOverrideDal(db);
    const policyService = new PolicyService({
      snapshotDal: policySnapshotDal,
      overrideDal: policyOverrideDal,
      configStore: createGatewayConfigStore({ db }),
    });
    await policyBundles.set({
      scope: { tenantId: DEFAULT_TENANT_ID, scopeKind: "deployment" },
      bundle: {
        v: 1,
        tools: { default: "deny", allow: ["bash"], require_approval: [], deny: [] },
      },
      createdBy: { kind: "test" },
    });
    await policyBundles.set({
      scope: { tenantId: DEFAULT_TENANT_ID, scopeKind: "agent", agentId: defaultAgentId },
      bundle: {
        v: 1,
        tools: { default: "deny", allow: [], require_approval: ["bash"], deny: [] },
      },
      createdBy: { kind: "test" },
    });

    const { scheduler } = createAutomationScheduler(context, { policyService });

    await processor.createWatcher(
      "plan-1",
      "periodic",
      cronStepsSchedule(1000, [{ type: "CLI", args: { cmd: "echo", args: ["scheduled"] } }]),
    );

    await scheduler.tick();

    const job = await db.get<{ policy_snapshot_id: string | null }>(
      "SELECT policy_snapshot_id FROM turn_jobs ORDER BY created_at DESC LIMIT 1",
    );
    const snapshot = await policySnapshotDal.getById(DEFAULT_TENANT_ID, job!.policy_snapshot_id!);
    expect(snapshot?.bundle.tools?.require_approval).toContain("bash");
    const decision = await policyService.evaluateToolCallFromSnapshot({
      tenantId: DEFAULT_TENANT_ID,
      policySnapshotId: job!.policy_snapshot_id!,
      agentId: defaultAgentId,
      workspaceId: DEFAULT_WORKSPACE_ID,
      toolId: "bash",
      toolMatchTarget: "echo scheduled",
    });
    expect(decision.decision).toBe("require_approval");
  });

  it("uses heartbeat trigger kind for heartbeat schedules", async () => {
    await withAutomationEnabledEnv(async () => {
      const context = requireWatcherSchedulerContext(state);
      const { processor } = context;
      const { enqueuedInputs, scheduler } = createAutomationScheduler(context);
      const key = buildHeartbeatConversationKey({
        agentKey: "default",
        workspaceKey: "default",
      });

      await processor.createWatcher(
        "plan-1",
        "periodic",
        heartbeatSchedule({
          instruction: "Review signals and act only if useful.",
          key,
        }),
      );

      await scheduler.tick();

      expect(enqueuedInputs).toHaveLength(1);
      const trigger = enqueuedInputs[0]?.["trigger"] as Record<string, unknown> | undefined;
      expect(trigger).toBeDefined();
      expect(trigger?.["kind"]).toBe("heartbeat");
      expect(enqueuedInputs[0]?.["key"]).toBe(key);
    });
  });

  it("enqueues a Decide step for heartbeat agent_turn schedules", async () => {
    const context = requireWatcherSchedulerContext(state);
    const { processor } = context;
    const { enqueuedInputs, scheduler } = createAutomationScheduler(context);

    await processor.createWatcher(
      "plan-1",
      "periodic",
      heartbeatSchedule({ instruction: "Review signals and act only if useful." }),
    );

    await scheduler.tick();

    expect(enqueuedInputs).toHaveLength(1);
    const steps = enqueuedInputs[0]?.["steps"] as Array<{
      type: string;
      args: Record<string, unknown>;
    }>;
    expect(steps).toHaveLength(1);
    expect(steps[0]!.type).toBe("Decide");
    expect(steps[0]!.args["channel"]).toBe("automation:default");
    expect(steps[0]!.args["thread_id"]).toBe("heartbeat");
    expect((steps[0]!.args["metadata"] as Record<string, unknown>)["automation"]).toBeDefined();
  });

  it("uses an agent-shaped key for heartbeat schedules when no key is configured", async () => {
    const context = requireWatcherSchedulerContext(state);
    const { processor } = context;
    const { enqueuedInputs, scheduler } = createAutomationScheduler(context);

    await processor.createWatcher("plan-1", "periodic", heartbeatSchedule());

    await scheduler.tick();

    expect(enqueuedInputs).toHaveLength(1);
    expect(enqueuedInputs[0]?.["key"]).toBe(
      buildHeartbeatConversationKey({
        agentKey: "default",
        workspaceKey: "default",
      }),
    );
  });

  it("derives heartbeat Decide routing from a configured custom heartbeat key", async () => {
    const context = requireWatcherSchedulerContext(state);
    const { processor } = context;
    const { enqueuedInputs, scheduler } = createAutomationScheduler(context);
    const customKey = buildAgentConversationKey({
      agentKey: "default",
      channel: "automation",
      account: "default~ops",
      container: "channel",
      id: "custom-heartbeat",
    });

    await processor.createWatcher(
      "plan-1",
      "periodic",
      heartbeatSchedule({
        instruction: "Review signals and act only if useful.",
        key: customKey,
      }),
    );

    await scheduler.tick();

    expect(enqueuedInputs).toHaveLength(1);
    const steps = enqueuedInputs[0]?.["steps"] as Array<{
      type: string;
      args: Record<string, unknown>;
    }>;
    expect(steps[0]!.args["channel"]).toBe("automation:ops");
    expect(steps[0]!.args["thread_id"]).toBe("custom-heartbeat");
    expect(steps[0]!.args["container_kind"]).toBe("channel");
    expect(enqueuedInputs[0]?.["key"]).toBe(customKey);
  });

  it("fails heartbeat firings loudly when a configured custom key escapes the watcher scope", async () => {
    const context = requireWatcherSchedulerContext(state);
    const { db, processor } = context;
    const { enqueuedInputs, scheduler } = createAutomationScheduler(context);

    await processor.createWatcher(
      "plan-1",
      "periodic",
      heartbeatSchedule({
        key: buildHeartbeatConversationKey({
          agentKey: "default",
          workspaceKey: "other-workspace",
        }),
      }),
    );

    await scheduler.tick();

    expect(enqueuedInputs).toHaveLength(0);
    const firing = await db.get<{ status: string; error: string | null }>(
      "SELECT status, error FROM watcher_firings ORDER BY created_at DESC LIMIT 1",
    );
    expect(firing?.status).toBe("failed");
    expect(firing?.error).toContain("does not match watcher scope");
  });

  it("suppresses a heartbeat enqueue when a prior heartbeat run is still active", async () => {
    const context = requireWatcherSchedulerContext(state);
    const { db, processor } = context;
    const { enqueuedInputs, scheduler } = createAutomationScheduler(context);

    await db.run(
      `INSERT INTO turn_jobs (tenant_id, job_id, agent_id, workspace_id, conversation_key, status, trigger_json)
       VALUES (?, ?, ?, ?, ?, 'running', ?)`,
      [
        DEFAULT_TENANT_ID,
        "00000000-0000-4000-8000-000000000201",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        buildHeartbeatConversationKey({
          agentKey: "default",
          workspaceKey: "default",
        }),
        "{}",
      ],
    );
    await db.run(
      `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, status, attempt)
       VALUES (?, ?, ?, ?, 'running', 1)`,
      [
        DEFAULT_TENANT_ID,
        "00000000-0000-4000-8000-000000000202",
        "00000000-0000-4000-8000-000000000201",
        buildHeartbeatConversationKey({
          agentKey: "default",
          workspaceKey: "default",
        }),
      ],
    );

    await processor.createWatcher("plan-1", "periodic", heartbeatSchedule());

    await scheduler.tick();

    expect(enqueuedInputs).toHaveLength(0);
    const firing = await db.get<{ status: string; turn_id: string | null }>(
      "SELECT status, turn_id FROM watcher_firings LIMIT 1",
    );
    expect(firing).toBeDefined();
    expect(firing!.status).toBe("enqueued");
    expect(firing!.turn_id).toBe("00000000-0000-4000-8000-000000000202");
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
      await processor.createWatcher(
        "plan-1",
        "periodic",
        heartbeatSchedule({ instruction: "Review signals and act only if useful." }),
      );

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

  it("routes cron schedules to a dedicated automation conversation", async () => {
    await withAutomationEnabledEnv(async () => {
      const context = requireWatcherSchedulerContext(state);
      const { processor } = context;
      const { enqueuedInputs, scheduler } = createAutomationScheduler(context);

      const watcherId = await processor.createWatcher(
        "plan-1",
        "periodic",
        cronStepsSchedule(1000, [{ type: "Desktop", args: { op: "screenshot" } }]),
      );

      await scheduler.tick();

      expect(enqueuedInputs).toHaveLength(1);
      expect(enqueuedInputs[0]?.["key"]).toBe(
        buildScheduleConversationKey({
          agentKey: "default",
          workspaceKey: "default",
          scheduleId: watcherId,
        }),
      );
    });
  });
}
