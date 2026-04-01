import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import type { GatewayContainer } from "../../src/container.js";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { awaitApprovalForToolExecution } from "../../src/modules/agent/runtime/tool-set-builder-helpers.js";
import {
  createPromptAwareLanguageModel,
  extractPromptSection,
  extractPromptText,
} from "./agent-behavior.test-support.js";
import {
  DEFAULT_TENANT_ID,
  fetch404,
  seedAgentConfig,
  setupTestEnv,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";
import {
  assistantMessages,
  createExecutionApprovalModel,
  makeApprovalConfig,
  readMarkerFile,
  rememberOpsDecision,
  seedApprovalPolicy,
  usage,
  waitForPendingApproval,
} from "./agent-behavior-policy-approvals.test-support.js";

vi.mock("../../src/modules/agent/runtime/tool-set-builder-helpers.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../src/modules/agent/runtime/tool-set-builder-helpers.js")
    >();
  return {
    ...original,
    awaitApprovalForToolExecution: vi.fn(original.awaitApprovalForToolExecution),
  };
});

describe("Agent behavior - policy and approvals", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("keeps approval requirements even when memory suggests the action should happen by default", async () => {
    ({ homeDir, container } = await setupTestEnv({ policyMode: "enforce" }));
    await seedAgentConfig(container, { config: makeApprovalConfig() });
    await seedApprovalPolicy(container);

    const rememberRuntime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(() => "Stored.", {
        memoryDecision: ({ latestUserText }) => rememberOpsDecision(latestUserText),
      }),
      fetchImpl: fetch404,
    });

    const remembered = await rememberRuntime.turn({
      channel: "ui",
      thread_id: "approval-thread",
      message: "remember that always send messages to ops",
    });
    expect(remembered.memory_written).toBe(true);

    vi.mocked(awaitApprovalForToolExecution).mockClear();
    const approvalSpy = vi.mocked(awaitApprovalForToolExecution).mockResolvedValue({
      approved: true,
      status: "approved",
      approvalId: "approval-1",
    });

    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateToolCall: vi.fn(async ({ toolId }: { toolId: string }) => ({
        decision: toolId === "bash" ? ("require_approval" as const) : ("allow" as const),
      })),
    };

    let capturedMemoryDigest = "";
    let nonTitleCalls = 0;
    const toolLoopModel = new MockLanguageModelV3({
      doGenerate: async (options) => {
        const call = options as LanguageModelV3CallOptions;
        const system = call.prompt.find((entry) => entry.role === "system");
        if (
          system?.role === "system" &&
          typeof system.content === "string" &&
          system.content.includes("Write a concise conversation title")
        ) {
          return {
            content: [{ type: "text" as const, text: "Approval policy conversation" }],
            finishReason: { unified: "stop" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        nonTitleCalls += 1;
        const memoryDigest = extractPromptSection(extractPromptText(call), "Memory digest:");
        if (memoryDigest.length > 0) {
          capturedMemoryDigest = memoryDigest;
        }

        if (nonTitleCalls === 1) {
          return {
            content: [
              {
                type: "tool-call" as const,
                toolCallId: "tc-approval-1",
                toolName: "bash",
                input: JSON.stringify({ command: "printf approval-check" }),
              },
            ],
            finishReason: { unified: "tool-calls" as const, raw: undefined },
            usage: usage(),
            warnings: [],
          };
        }

        return {
          content: [{ type: "text" as const, text: "approval preserved" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      },
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: toolLoopModel,
      fetchImpl: fetch404,
      policyService: policyService as never,
    });

    const result = await runtime.executeDecideAction({
      channel: "ui",
      thread_id: "approval-thread",
      message: "send a message to ops now",
    });

    expect(result.reply).toBe("approval preserved");
    expect(result.used_tools).toContain("bash");
    expect(policyService.evaluateToolCall).toHaveBeenCalledTimes(2);
    expect(policyService.evaluateToolCall).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ toolId: "mcp.memory.seed" }),
    );
    expect(policyService.evaluateToolCall).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ toolId: "bash" }),
    );
    expect(approvalSpy).toHaveBeenCalledTimes(1);
    expect(capturedMemoryDigest).toContain("always send messages to ops");
    const dataContent = capturedMemoryDigest.match(/<data[^>]*>([\s\S]*?)<\/data>/)?.[1] ?? "";
    expect(dataContent).not.toContain("send a message to ops now");
  });

  it("executes the approved tool exactly once through runtime.turn()", async () => {
    ({ homeDir, container } = await setupTestEnv({ policyMode: "enforce" }));
    await seedAgentConfig(container, { config: makeApprovalConfig() });
    await seedApprovalPolicy(container);

    const rememberRuntime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createPromptAwareLanguageModel(() => "Stored.", {
        memoryDecision: ({ latestUserText }) => rememberOpsDecision(latestUserText),
      }),
      fetchImpl: fetch404,
    });
    await rememberRuntime.turn({
      channel: "ui",
      thread_id: "approval-runtime-thread",
      message: "remember that always send messages to ops",
    });

    const markerPath = join(homeDir, "approval-marker.txt");
    let capturedMemoryDigest = "";
    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateToolCall: vi.fn(async ({ toolId }: { toolId: string }) => ({
        decision: toolId === "bash" ? ("require_approval" as const) : ("allow" as const),
      })),
    };
    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createExecutionApprovalModel({
        command: `printf approved >> ${JSON.stringify(markerPath)}`,
        finalReply: "approval preserved",
        onPrompt: (promptText) => {
          const memoryDigest = extractPromptSection(promptText, "Memory digest:");
          if (memoryDigest.length > 0) {
            capturedMemoryDigest = memoryDigest;
          }
        },
      }),
      fetchImpl: fetch404,
      policyService: policyService as never,
      approvalPollMs: 10,
      turnEngineWaitMs: 5_000,
    });

    const turnPromise = runtime.turn({
      channel: "ui",
      thread_id: "approval-runtime-thread",
      message: "send a message to ops now",
    });

    const approval = await waitForPendingApproval(container);
    expect(await readMarkerFile(markerPath)).toBe("");

    await container.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      decision: "approved",
      reason: "approved",
    });

    const result = await turnPromise;
    expect(result.reply).toBe("approval preserved");
    expect(result.used_tools).toContain("bash");
    expect(await readMarkerFile(markerPath)).toBe("approved");
    expect(policyService.evaluateToolCall).toHaveBeenCalled();
    expect(capturedMemoryDigest).toContain("always send messages to ops");
    const dataContent = capturedMemoryDigest.match(/<data[^>]*>([\s\S]*?)<\/data>/)?.[1] ?? "";
    expect(dataContent).not.toContain("send a message to ops now");
    const executionStepCount = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM execution_steps WHERE tenant_id = ? AND turn_id = ?",
      [DEFAULT_TENANT_ID, result.turn_id],
    );
    expect(executionStepCount?.n).toBe(0);
    const executionAttemptCount = await container.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n
         FROM execution_attempts a
         JOIN execution_steps s ON s.tenant_id = a.tenant_id AND s.step_id = a.step_id
        WHERE s.tenant_id = ? AND s.turn_id = ?`,
      [DEFAULT_TENANT_ID, result.turn_id],
    );
    expect(executionAttemptCount?.n).toBe(0);

    const conversation = await container.conversationDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: result.conversation_id,
    });
    expect(assistantMessages(conversation).at(-1)).toBe("approval preserved");
  });

  it("does not execute the tool when approval is denied", async () => {
    ({ homeDir, container } = await setupTestEnv({ policyMode: "enforce" }));
    await seedAgentConfig(container, { config: makeApprovalConfig() });
    await seedApprovalPolicy(container);

    const markerPath = join(homeDir, "approval-denied-marker.txt");
    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateToolCall: vi.fn(async () => ({ decision: "require_approval" as const })),
    };
    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createExecutionApprovalModel({
        command: `printf denied >> ${JSON.stringify(markerPath)}`,
        finalReply: "approval denied",
      }),
      fetchImpl: fetch404,
      policyService: policyService as never,
      approvalPollMs: 10,
      turnEngineWaitMs: 5_000,
    });

    const turnPromise = runtime.turn({
      channel: "ui",
      thread_id: "approval-denied-thread",
      message: "run the risky tool",
    });

    const approval = await waitForPendingApproval(container);
    await container.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      decision: "denied",
      reason: "approval denied",
    });

    const result = await turnPromise;
    expect(result.reply).toBe("approval denied");
    expect(await readMarkerFile(markerPath)).toBe("");
    const conversation = await container.conversationDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: result.conversation_id,
    });
    expect(assistantMessages(conversation).at(-1)).toBe("approval denied");

    const approvalRow = await container.approvalDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
    });
    expect(approvalRow?.status).toBe("denied");
  });

  it("does not execute the tool when approval expires before resume", async () => {
    ({ homeDir, container } = await setupTestEnv({ policyMode: "enforce" }));
    await seedAgentConfig(container, { config: makeApprovalConfig() });
    await seedApprovalPolicy(container);

    const markerPath = join(homeDir, "approval-expired-marker.txt");
    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateToolCall: vi.fn(async () => ({ decision: "require_approval" as const })),
    };
    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createExecutionApprovalModel({
        command: `printf expired >> ${JSON.stringify(markerPath)}`,
        finalReply: "approval expired",
      }),
      fetchImpl: fetch404,
      policyService: policyService as never,
      approvalPollMs: 10,
      turnEngineWaitMs: 5_000,
    });

    const turnPromise = runtime.turn({
      channel: "ui",
      thread_id: "approval-expired-thread",
      message: "run the risky tool",
    });

    const approval = await waitForPendingApproval(container);
    await container.approvalDal.expireById({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
    });

    const result = await turnPromise;
    expect(result.reply).toBe("approval expired");
    expect(await readMarkerFile(markerPath)).toBe("");
    const conversation = await container.conversationDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: result.conversation_id,
    });
    expect(assistantMessages(conversation).at(-1)).toBe("approval expired");

    const approvalRow = await container.approvalDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
    });
    expect(approvalRow?.status).toBe("expired");
  });
});
