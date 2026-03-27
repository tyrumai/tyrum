import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
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
import { seedApprovalPolicy, usage } from "./agent-behavior-policy-approvals.test-support.js";

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

function makeApprovalConfig(): Record<string, unknown> {
  const memorySettings = {
    enabled: true,
    keyword: { enabled: true, limit: 20 },
    semantic: { enabled: false, limit: 1 },
    structured: { fact_keys: [], tags: [] },
    budgets: {
      max_total_items: 10,
      max_total_chars: 4000,
      per_kind: {
        fact: { max_items: 4, max_chars: 1200 },
        note: { max_items: 6, max_chars: 2400 },
        procedure: { max_items: 2, max_chars: 1200 },
        episode: { max_items: 4, max_chars: 1600 },
      },
    },
  };
  return {
    model: { model: "openai/gpt-4.1" },
    skills: { default_mode: "deny", workspace_trusted: false },
    mcp: {
      default_mode: "allow",
      pre_turn_tools: ["mcp.memory.seed"],
      server_settings: { memory: memorySettings },
    },
    tools: { default_mode: "allow", allow: ["bash"] },
    conversations: { ttl_days: 30, max_turns: 20 },
  };
}

function rememberOpsDecision(latestUserText: string) {
  return latestUserText.toLowerCase().includes("remember that always send messages to ops")
    ? {
        should_store: true as const,
        reason: "Durable standing instruction from the user.",
        memory: {
          kind: "note" as const,
          body_md: "remember that always send messages to ops",
        },
      }
    : undefined;
}

async function waitForPendingApproval(container: GatewayContainer): Promise<{
  approval_id: string;
}> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const pending = await container.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID });
    if (pending.length > 0) {
      return pending[0]!;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for pending approval");
}

async function readMarkerFile(markerPath: string): Promise<string> {
  try {
    return await readFile(markerPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function assistantMessages(
  session: Awaited<ReturnType<GatewayContainer["sessionDal"]["getById"]>> | undefined,
): string[] {
  return (
    session?.transcript.flatMap((item) =>
      item.kind === "text" && item.role === "assistant" ? [item.content] : [],
    ) ?? []
  );
}

function createExecutionApprovalModel(input: {
  command: string;
  finalReply: string;
  onPrompt?: (promptText: string) => void;
}): MockLanguageModelV3 {
  const coerceToolResultStatus = (value: unknown): string | undefined => {
    const candidate =
      typeof value === "string"
        ? (() => {
            try {
              return JSON.parse(value) as unknown;
            } catch {
              return value;
            }
          })()
        : value;
    if (!candidate || typeof candidate !== "object") {
      return undefined;
    }
    const status = (candidate as { status?: unknown }).status;
    return typeof status === "string" ? status : undefined;
  };

  const extractApprovalOutcome = (
    call: LanguageModelV3CallOptions,
  ): { approved: boolean; reason?: string } | undefined => {
    for (const entry of call.prompt.toReversed()) {
      if (entry.role !== "tool" || !Array.isArray(entry.content)) {
        continue;
      }

      for (const part of entry.content.toReversed()) {
        if (!part || typeof part !== "object") continue;
        const record = part as {
          type?: unknown;
          approved?: unknown;
          reason?: unknown;
          output?: unknown;
        };
        if (record.type === "tool-approval-response") {
          return {
            approved: record.approved === true,
            reason: typeof record.reason === "string" ? record.reason : undefined,
          };
        }
        if (record.type === "tool-result") {
          const status = coerceToolResultStatus(record.output);
          if (status === "denied" || status === "expired") {
            return {
              approved: false,
              reason: status === "expired" ? "approval expired" : "approval denied",
            };
          }
        }
      }
    }

    return undefined;
  };

  let nonTitleCalls = 0;
  return new MockLanguageModelV3({
    doGenerate: async (options) => {
      const call = options as LanguageModelV3CallOptions;
      const system = call.prompt.find((entry) => entry.role === "system");
      if (
        system?.role === "system" &&
        typeof system.content === "string" &&
        system.content.includes("Write a concise session title")
      ) {
        return {
          content: [{ type: "text" as const, text: "Approval policy session" }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      }

      nonTitleCalls += 1;
      input.onPrompt?.(extractPromptText(call));
      if (nonTitleCalls === 1) {
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "tc-approval-1",
              toolName: "bash",
              input: JSON.stringify({ command: input.command }),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      }

      const approvalOutcome = extractApprovalOutcome(call);
      const deniedReason = approvalOutcome?.reason?.toLowerCase() ?? "";
      const reply =
        approvalOutcome?.approved === false
          ? deniedReason.includes("expired")
            ? "approval expired"
            : "approval denied"
          : input.finalReply;

      return {
        content: [{ type: "text" as const, text: reply }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: usage(),
        warnings: [],
      };
    },
  });
}

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
          system.content.includes("Write a concise session title")
        ) {
          return {
            content: [{ type: "text" as const, text: "Approval policy session" }],
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

    const session = await container.sessionDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      sessionId: result.conversation_id,
    });
    expect(assistantMessages(session).at(-1)).toBe("approval preserved");
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
    const session = await container.sessionDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      sessionId: result.conversation_id,
    });
    expect(assistantMessages(session).at(-1)).toBe("approval denied");

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
    const session = await container.sessionDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      sessionId: result.conversation_id,
    });
    expect(assistantMessages(session).at(-1)).toBe("approval expired");

    const approvalRow = await container.approvalDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
    });
    expect(approvalRow?.status).toBe("expired");
  });
});
