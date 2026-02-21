import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { createApp } from "../../src/app.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createStubLanguageModel } from "../unit/stub-language-model.js";
import { PresenceDal } from "../../src/modules/presence/dal.js";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { GatewayStatusResponse } from "@tyrum/schemas";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("observability surfaces", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("exposes /status, /context, and /usage", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-observability-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });

    const agentRuntime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
      fetchImpl: (async () => new Response("not found", { status: 404 })) as typeof fetch,
    });

    // Create one agent turn to persist a context report (+ usage totals).
    await agentRuntime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
    });

    const connectionManager = new ConnectionManager();
    const presenceDal = new PresenceDal(container.db);
    const executionEngine = new ExecutionEngine({ db: container.db, logger: container.logger });

    const app = createApp(container, {
      agentRuntime,
      executionEngine,
      connectionManager,
      presence: {
        dal: presenceDal,
        instanceId: "gw-test",
        startedAtMs: Date.now() - 5_000,
        role: "edge",
        version: "test",
      },
    });

    const contextRes = await app.request("/context?limit=10");
    expect(contextRes.status).toBe(200);
    const contextBody = (await contextRes.json()) as { reports: Array<{ context_report_id: string }> };
    expect(contextBody.reports.length).toBeGreaterThan(0);
    const reportId = contextBody.reports[0]!.context_report_id;
    expect(typeof reportId).toBe("string");

    const contextDetailRes = await app.request(`/context/${encodeURIComponent(reportId)}`);
    expect(contextDetailRes.status).toBe(200);
    const contextDetailBody = await contextDetailRes.json();
    expect(contextDetailBody).toHaveProperty("plan_id");
    expect(contextDetailBody).toHaveProperty("totals.total_bytes");
    expect(contextDetailBody).toHaveProperty("tools.largest_schemas");

    const usageRes = await app.request("/usage");
    expect(usageRes.status).toBe(200);
    const usageBody = (await usageRes.json()) as {
      agent: { turns: number; total_tokens: number };
      execution: { attempts: number };
      provider: { status: string };
    };
    expect(usageBody.agent.turns).toBeGreaterThan(0);
    expect(usageBody.agent.total_tokens).toBeGreaterThan(0);
    expect(usageBody.provider.status).toBe("disabled");

    const statusRes = await app.request("/status");
    expect(statusRes.status).toBe(200);
    const statusJson = await statusRes.json();
    const parsed = GatewayStatusResponse.safeParse(statusJson);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.context.last_report).not.toBeNull();
    }
  });
});

