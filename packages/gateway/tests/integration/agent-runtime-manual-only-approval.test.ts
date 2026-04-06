import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MockLanguageModelV3 } from "ai/test";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import {
  DEFAULT_TENANT_ID,
  fetch404,
  migrationsDir,
  seedAgentConfig,
  teardownTestEnv,
} from "../unit/agent-runtime.test-helpers.js";

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

function createApprovalLanguageModel(): MockLanguageModelV3 {
  let callCount = 0;

  return new MockLanguageModelV3({
    doGenerate: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "tc-manual-only",
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
}

function stubMcpManager() {
  return {
    listToolDescriptors: vi.fn(async () => []),
    shutdown: vi.fn(async () => {}),
    callTool: vi.fn(async () => ({ content: [] })),
  };
}

function forceManualOnlyApprovalReview(container: GatewayContainer): void {
  const original = container.policyService.loadEffectiveBundle.bind(container.policyService);
  vi.spyOn(container.policyService, "loadEffectiveBundle").mockImplementation(async (params) => {
    const effective = await original(params);
    return {
      ...effective,
      bundle: {
        ...effective.bundle,
        approvals: {
          auto_review: {
            mode: "manual_only" as const,
          },
        },
      },
    };
  });
}

async function waitForPendingApproval(
  container: GatewayContainer,
  timeoutMs = 5_000,
): Promise<{ approval_id: string; prompt: string; status: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = await container.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID });
    if (pending.length > 0) {
      return pending[0]!;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for pending approval");
}

describe("AgentRuntime manual-only approvals", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("creates runtime turn approvals as awaiting_human", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-runtime-manual-only-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    forceManualOnlyApprovalReview(container);

    await seedAgentConfig(container, {
      agentKey: "agent-test",
      workspaceKey: "ws-test",
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

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      agentId: "agent-test",
      workspaceId: "ws-test",
      languageModel: createApprovalLanguageModel(),
      fetchImpl: fetch404,
      mcpManager: stubMcpManager() as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
      approvalWaitMs: 10_000,
      approvalPollMs: 50,
      turnEngineWaitMs: 5_000,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-approval-manual-only-1",
      message: "run a command",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("bash");
    expect(pending.status).toBe("awaiting_human");

    const updated = await container.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: pending.approval_id,
      decision: "approved",
      reason: "approved in test",
    });
    if (updated?.resume_token) {
      await runtime.turnController.resumeTurn(updated.resume_token);
    }

    const result = await turnPromise;
    expect(result.reply).toBe("done");
    expect(result.used_tools).toContain("bash");
  }, 10_000);
});
