import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MockLanguageModelV3 } from "ai/test";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRegistry } from "../../src/modules/agent/registry.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createProtocolRuntime, createWorkerLoop } from "../../src/bootstrap/runtime-builders.js";
import type { GatewayBootContext } from "../../src/bootstrap/runtime-shared.js";
import {
  DEFAULT_TENANT_ID,
  fetch404,
  migrationsDir,
  seedAgentConfig,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";

describe("AgentRuntime worker approval resumes", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("completes approved tool resumes when the background worker claims the decide step", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });

    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: { enabled: [] },
        tools: { allow: ["bash"] },
        sessions: { ttl_days: 30, max_turns: 20 },
        memory: { v1: { enabled: false } },
      },
    });

    const usage = () => ({
      inputTokens: {
        total: 10,
        noCache: 10,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: 5,
        text: 5,
        reasoning: undefined,
      },
    });

    let callCount = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "tc-1",
                toolName: "bash",
                input: JSON.stringify({ command: "echo hi" }),
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        return {
          content: [{ type: "text" as const, text: "done" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      },
    });

    const logger = container.logger.child({ test: "agent-runtime-worker-resume" });
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
      approvalNotifier: protocol.approvalNotifier,
      protocolDeps: protocol.protocolDeps,
      logger,
    });
    protocol.protocolDeps.agents = agents;

    const workerLoop = createWorkerLoop(context, protocol);
    expect(workerLoop).toBeDefined();

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: model,
      fetchImpl: fetch404,
      approvalPollMs: 5_000,
      turnEngineWaitMs: 10_000,
    } as ConstructorParameters<typeof AgentRuntime>[0]);

    try {
      const turnPromise = runtime.turn({
        channel: "test",
        thread_id: "thread-1",
        message: "run tool",
      });

      const deadlineMs = Date.now() + 2_000;
      let approvalId: string | undefined;
      while (Date.now() < deadlineMs) {
        const pending = await container.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID });
        if (pending.length > 0) {
          approvalId = pending[0]!.approval_id;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      if (!approvalId) {
        throw new Error("timed out waiting for pending approval");
      }

      await container.approvalDal.respond({
        tenantId: DEFAULT_TENANT_ID,
        approvalId,
        decision: "approved",
      });

      const updated = await container.approvalDal.getById({
        tenantId: DEFAULT_TENANT_ID,
        approvalId,
      });
      expect(updated?.resume_token).toBeTruthy();

      await (
        runtime as AgentRuntime & {
          executionEngine: { resumeRun: (token: string) => Promise<string | undefined> };
        }
      ).executionEngine.resumeRun(updated!.resume_token!);

      const result = await turnPromise;
      expect(result.reply).toBe("done");
      expect(result.used_tools).toContain("bash");
    } finally {
      workerLoop?.stop();
      await workerLoop?.done;
      protocol.approvalEngineActionProcessor?.stop();
      await agents.shutdown();
    }
  }, 15_000);
});
