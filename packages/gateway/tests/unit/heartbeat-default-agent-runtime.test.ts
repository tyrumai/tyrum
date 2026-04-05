import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MockLanguageModelV3 } from "ai/test";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRegistry } from "../../src/modules/agent/registry.js";
import { createProtocolRuntime, createWorkerLoop } from "../../src/bootstrap/runtime-builders.js";
import type { GatewayBootContext } from "../../src/bootstrap/runtime-shared.js";
import { ScheduleService } from "../../src/modules/automation/schedule-service.js";
import { WatcherScheduler } from "../../src/modules/watcher/scheduler.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  migrationsDir,
  seedAgentConfig,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";

describe("default heartbeat runtime selection", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("fires the seeded default heartbeat without creating a UUID-scoped agent runtime", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-heartbeat-default-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });

    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: {
          enabled: [],
          server_settings: { memory: { enabled: false } },
        },
        tools: { allow: [] },
        conversations: { ttl_days: 30, max_turns: 20 },
      },
    });

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text" as const, text: "done" }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
    });

    const logger = container.logger.child({ test: "heartbeat-default-agent-runtime" });
    const secretProviderForTenant = (() => ({
      list: async () => [],
      resolve: async () => null,
      store: async () => {
        throw new Error("not implemented");
      },
      revoke: async () => false,
    })) as GatewayBootContext["secretProviderForTenant"];
    const context: GatewayBootContext = {
      instanceId: "test-instance",
      role: "all",
      tyrumHome: homeDir,
      host: "127.0.0.1",
      port: 8788,
      dbPath: ":memory:",
      migrationsDir,
      isLocalOnly: true,
      shouldRunEdge: false,
      shouldRunWorker: true,
      deploymentConfig: container.deploymentConfig,
      container,
      logger,
      authTokens: {} as GatewayBootContext["authTokens"],
      secretProviderForTenant,
      lifecycleHooks: [],
    };

    const protocol = await createProtocolRuntime(context, {
      enabled: false,
      shutdown: async () => undefined,
    });
    const agents = new AgentRegistry({
      container,
      baseHome: homeDir,
      secretProviderForTenant,
      defaultPolicyService: container.policyService,
      defaultLanguageModel: model,
      protocolDeps: protocol.protocolDeps,
      logger,
    });
    protocol.protocolDeps.agents = agents;

    const workerLoop = createWorkerLoop(context, protocol);
    expect(workerLoop).toBeDefined();

    try {
      const scheduleService = new ScheduleService(container.db, container.identityScopeDal);
      await scheduleService.ensureDefaultHeartbeatScheduleForMembership({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        nowMs: Date.now(),
      });

      const [defaultHeartbeat] = await scheduleService.listSchedules({
        tenantId: DEFAULT_TENANT_ID,
        includeDeleted: true,
      });
      if (!defaultHeartbeat) {
        throw new Error("expected seeded default heartbeat schedule");
      }

      await scheduleService.updateSchedule({
        tenantId: DEFAULT_TENANT_ID,
        scheduleId: defaultHeartbeat.schedule_id,
        patch: { cadence: { type: "interval", interval_ms: 1_000 } },
      });
      await container.db.run(
        `UPDATE watchers
         SET last_fired_at_ms = 0
         WHERE tenant_id = ? AND watcher_id = ?`,
        [DEFAULT_TENANT_ID, defaultHeartbeat.schedule_id],
      );

      const scheduler = new WatcherScheduler({
        db: container.db,
        eventBus: container.eventBus,
        owner: "scheduler-1",
        logger,
        policyService: container.policyService,
        automationEnabled: true,
      });

      await scheduler.tick();

      const deadlineMs = Date.now() + 5_000;
      while (Date.now() < deadlineMs) {
        const run = await container.db.get<{ status: string }>(
          `SELECT status
           FROM turns
           WHERE tenant_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
          [DEFAULT_TENANT_ID],
        );
        if (run && !["queued", "running", "paused"].includes(run.status)) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const latestRun = await container.db.get<{ status: string }>(
        `SELECT status
         FROM turns
         WHERE tenant_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [DEFAULT_TENANT_ID],
      );
      expect(latestRun?.status).toBe("succeeded");

      const agentDirs = await readdir(join(homeDir, "agents"));
      expect(agentDirs).toContain("default");
      expect(agentDirs).not.toContain(DEFAULT_AGENT_ID);

      const agentRows = await container.db.all<{ agent_key: string }>(
        `SELECT agent_key
         FROM agents
         WHERE tenant_id = ?
         ORDER BY agent_key ASC`,
        [DEFAULT_TENANT_ID],
      );
      expect(agentRows.map((row) => row.agent_key)).toEqual(["default"]);
    } finally {
      workerLoop?.stop();
      await workerLoop?.done;
      protocol.approvalEngineActionProcessor?.stop();
      await agents.shutdown();
    }
  }, 15_000);
});
