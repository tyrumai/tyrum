import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRegistry } from "../../src/modules/agent/registry.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { TurnItemDal } from "../../src/modules/agent/turn-item-dal.js";
import {
  createConversationLoop,
  createProtocolRuntime,
  createWorkerLoop,
} from "../../src/bootstrap/runtime-builders.js";
import type { GatewayBootContext } from "../../src/bootstrap/runtime-shared.js";
import {
  DEFAULT_TENANT_ID,
  fetch404,
  migrationsDir,
  seedAgentConfig,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";

function usage() {
  return {
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
  };
}

function createApprovalResumeLanguageModel(): {
  getCallCount: () => number;
  model: MockLanguageModelV3;
} {
  let callCount = 0;

  return {
    getCallCount: () => callCount,
    model: new MockLanguageModelV3({
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
      doStream: async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            stream: simulateReadableStream({
              chunks: [
                {
                  type: "tool-call" as const,
                  toolCallId: "tc-1",
                  toolName: "bash",
                  input: JSON.stringify({ command: "echo hi" }),
                },
                {
                  type: "finish" as const,
                  finishReason: { unified: "tool-calls" as const, raw: undefined },
                  logprobs: undefined,
                  usage: usage(),
                },
              ],
            }),
            warnings: [],
          };
        }

        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start" as const, id: "text-1" },
              { type: "text-delta" as const, id: "text-1", delta: "done" },
              { type: "text-end" as const, id: "text-1" },
              {
                type: "finish" as const,
                finishReason: { unified: "stop" as const, raw: undefined },
                logprobs: undefined,
                usage: usage(),
              },
            ],
          }),
          warnings: [],
        };
      },
    }),
  };
}

async function waitForBlockedApproval(
  container: GatewayContainer,
  timeoutMs = 2_000,
): Promise<{ approval_id: string }> {
  const deadlineMs = Date.now() + timeoutMs;
  while (Date.now() < deadlineMs) {
    const pending = await container.approvalDal.listBlocked({ tenantId: DEFAULT_TENANT_ID });
    if (pending.length > 0) {
      return pending[0]!;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for pending approval");
}

async function waitForLatestTurnStatus(
  container: GatewayContainer,
  status: string,
  timeoutMs = 5_000,
): Promise<{ status: string; turn_id: string }> {
  const deadlineMs = Date.now() + timeoutMs;
  while (Date.now() < deadlineMs) {
    const row = await container.db.get<{ status: string; turn_id: string }>(
      `SELECT status, turn_id
         FROM turns
         ORDER BY created_at DESC, turn_id DESC
         LIMIT 1`,
    );
    if (row?.status === status) {
      return row;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for turn status '${status}'`);
}

async function createWorkerApprovalHarness(input: {
  approvalPollMs?: number;
  container: GatewayContainer;
  homeDir: string;
  turnEngineWaitMs?: number;
}): Promise<{
  agents: AgentRegistry;
  getCallCount: () => number;
  protocol: Awaited<ReturnType<typeof createProtocolRuntime>>;
  runtime: AgentRuntime;
  workerLoop: ReturnType<typeof createWorkerLoop>;
}> {
  const modelState = createApprovalResumeLanguageModel();

  await seedAgentConfig(input.container, {
    config: {
      model: { model: "openai/gpt-4.1" },
      skills: { enabled: [] },
      mcp: {
        enabled: [],
        server_settings: { memory: { enabled: false } },
      },
      tools: { allow: ["bash"] },
      conversations: { ttl_days: 30, max_turns: 20 },
    },
  });

  const logger = input.container.logger.child({ test: "agent-runtime-worker-resume" });
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
    tyrumHome: input.homeDir,
    host: "127.0.0.1",
    port: 8788,
    dbPath: ":memory:",
    migrationsDir,
    isLocalOnly: true,
    shouldRunEdge: false,
    shouldRunWorker: true,
    deploymentConfig: input.container.deploymentConfig,
    container: input.container,
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
    container: input.container,
    baseHome: input.homeDir,
    secretProviderForTenant,
    defaultPolicyService: input.container.policyService,
    defaultLanguageModel: modelState.model,
    protocolDeps: protocol.protocolDeps,
    logger,
  });
  protocol.protocolDeps.agents = agents;

  const workerLoop = createWorkerLoop(context, protocol);
  expect(workerLoop).toBeDefined();

  const runtime = new AgentRuntime({
    container: input.container,
    home: input.homeDir,
    languageModel: modelState.model,
    fetchImpl: fetch404,
    approvalPollMs: input.approvalPollMs ?? 5_000,
    turnEngineWaitMs: input.turnEngineWaitMs ?? 10_000,
  } as ConstructorParameters<typeof AgentRuntime>[0]);

  return {
    agents,
    getCallCount: modelState.getCallCount,
    protocol,
    runtime,
    workerLoop,
  };
}

async function createConversationApprovalHarness(input: {
  approvalPollMs?: number;
  container: GatewayContainer;
  homeDir: string;
  turnEngineWaitMs?: number;
}): Promise<{
  agents: AgentRegistry;
  conversationLoop: NonNullable<ReturnType<typeof createConversationLoop>>;
  getCallCount: () => number;
  protocol: Awaited<ReturnType<typeof createProtocolRuntime>>;
  runtime: AgentRuntime;
}> {
  const modelState = createApprovalResumeLanguageModel();

  await seedAgentConfig(input.container, {
    config: {
      model: { model: "openai/gpt-4.1" },
      skills: { enabled: [] },
      mcp: {
        enabled: [],
        server_settings: { memory: { enabled: false } },
      },
      tools: { allow: ["bash"] },
      conversations: { ttl_days: 30, max_turns: 20 },
    },
  });

  const logger = input.container.logger.child({ test: "agent-runtime-conversation-resume" });
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
    tyrumHome: input.homeDir,
    host: "127.0.0.1",
    port: 8788,
    dbPath: ":memory:",
    migrationsDir,
    isLocalOnly: true,
    shouldRunEdge: true,
    shouldRunWorker: false,
    deploymentConfig: input.container.deploymentConfig,
    container: input.container,
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
    container: input.container,
    baseHome: input.homeDir,
    secretProviderForTenant,
    defaultPolicyService: input.container.policyService,
    defaultLanguageModel: modelState.model,
    protocolDeps: protocol.protocolDeps,
    logger,
  });
  protocol.protocolDeps.agents = agents;

  const conversationLoop = createConversationLoop(context, protocol);
  expect(conversationLoop).toBeDefined();

  const runtime = new AgentRuntime({
    container: input.container,
    home: input.homeDir,
    languageModel: modelState.model,
    fetchImpl: fetch404,
    approvalPollMs: input.approvalPollMs ?? 5_000,
    turnEngineWaitMs: input.turnEngineWaitMs ?? 10_000,
  } as ConstructorParameters<typeof AgentRuntime>[0]);

  return {
    agents,
    conversationLoop: conversationLoop!,
    getCallCount: modelState.getCallCount,
    protocol,
    runtime,
  };
}

describe("AgentRuntime worker approval resumes", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("completes approved tool resumes without execution steps on the runner path", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });
    const { agents, conversationLoop, getCallCount, protocol, runtime } =
      await createConversationApprovalHarness({ container, homeDir });

    try {
      const turnPromise = runtime.turn({
        channel: "test",
        thread_id: "thread-1",
        message: "run tool",
      });

      const approval = await waitForBlockedApproval(container);
      const pausedTurn = await waitForLatestTurnStatus(container, "paused");
      const pausedCheckpoint = await container.db.get<{ checkpoint_json: string | null }>(
        "SELECT checkpoint_json FROM turns WHERE turn_id = ? LIMIT 1",
        [pausedTurn.turn_id],
      );
      expect(pausedCheckpoint?.checkpoint_json).toContain(approval.approval_id);
      const pausedWorkflowRunCount = await container.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM workflow_runs WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      expect(pausedWorkflowRunCount?.n).toBe(0);
      const pausedWorkflowStepCount = await container.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM workflow_run_steps WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      expect(pausedWorkflowStepCount?.n).toBe(0);
      const pausedItems = await new TurnItemDal(container.db).listByTurnId({
        tenantId: DEFAULT_TENANT_ID,
        turnId: pausedTurn.turn_id,
      });
      expect(pausedItems.map((item) => item.payload.message.role)).toEqual(["assistant"]);
      expect(pausedItems[0]?.payload.message.metadata?.approval_id).toBe(approval.approval_id);

      await container.approvalDal.resolveWithEngineAction({
        tenantId: DEFAULT_TENANT_ID,
        approvalId: approval.approval_id,
        decision: "approved",
      });

      const updated = await container.approvalDal.getById({
        tenantId: DEFAULT_TENANT_ID,
        approvalId: approval.approval_id,
      });
      expect(updated?.resume_token).toBeTruthy();

      await (
        runtime as AgentRuntime & {
          turnController: { resumeTurn: (token: string) => Promise<string | undefined> };
        }
      ).turnController.resumeTurn(updated!.resume_token!);

      const result = await turnPromise;
      expect(result.reply).toBe("done");
      expect(getCallCount()).toBeGreaterThanOrEqual(2);
      const completedTurn = await container.db.get<{ status: string }>(
        "SELECT status FROM turns WHERE turn_id = ? LIMIT 1",
        [pausedTurn.turn_id],
      );
      expect(completedTurn?.status).toBe("succeeded");
      const completedWorkflowRunCount = await container.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM workflow_runs WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      expect(completedWorkflowRunCount?.n).toBe(0);
      const items = await new TurnItemDal(container.db).listByTurnId({
        tenantId: DEFAULT_TENANT_ID,
        turnId: result.turn_id,
      });
      expect(items.map((item) => item.payload.message.role)).toEqual([
        "user",
        "assistant",
        "assistant",
      ]);
      expect(items[1]?.payload.message.metadata?.approval_id).toBe(approval.approval_id);
    } finally {
      conversationLoop.stop();
      await conversationLoop.done;
      protocol.approvalEngineActionProcessor?.stop();
      await agents.shutdown();
    }
  }, 15_000);

  it("does not cancel a paused ingress turn after the request wait window elapses", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });
    const { agents, protocol, runtime, workerLoop } = await createWorkerApprovalHarness({
      approvalPollMs: 20,
      container,
      homeDir,
      turnEngineWaitMs: 100,
    });

    try {
      const turn = await runtime.turnIngressStream({
        channel: "test",
        thread_id: "thread-ingress-pause-1",
        message: "run tool",
      });

      await expect(turn.outcome).resolves.toBe("paused");

      const pausedTurn = await waitForLatestTurnStatus(container, "paused");
      await new Promise((resolve) => setTimeout(resolve, 150));

      const stillPaused = await container.db.get<{ status: string }>(
        "SELECT status FROM turns WHERE turn_id = ?",
        [pausedTurn.turn_id],
      );
      expect(stillPaused?.status).toBe("paused");

      const approval = await waitForBlockedApproval(container);
      await container.approvalDal.resolveWithEngineAction({
        tenantId: DEFAULT_TENANT_ID,
        approvalId: approval.approval_id,
        decision: "approved",
      });

      const updated = await container.approvalDal.getById({
        tenantId: DEFAULT_TENANT_ID,
        approvalId: approval.approval_id,
      });
      expect(updated?.resume_token).toBeTruthy();

      await (
        runtime as AgentRuntime & {
          turnController: { resumeTurn: (token: string) => Promise<string | undefined> };
        }
      ).turnController.resumeTurn(updated!.resume_token!);

      await waitForLatestTurnStatus(container, "succeeded");
      const result = await turn.finalize();
      expect(result.reply).toBe("done");
    } finally {
      workerLoop?.stop();
      await workerLoop?.done;
      protocol.approvalEngineActionProcessor?.stop();
      await agents.shutdown();
    }
  }, 15_000);
});
