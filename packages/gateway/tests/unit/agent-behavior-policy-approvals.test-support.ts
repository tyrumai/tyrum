import { readFile } from "node:fs/promises";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import type { GatewayContainer } from "../../src/container.js";
import { seedDeploymentPolicyBundle } from "../helpers/runtime-config.js";
import { extractPromptText } from "./agent-behavior.test-support.js";
import { DEFAULT_TENANT_ID } from "./agent-runtime.test-helpers.js";

export function usage() {
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

export async function seedApprovalPolicy(container: GatewayContainer): Promise<void> {
  await seedDeploymentPolicyBundle(container.db, {
    v: 1,
    tools: {
      allow: ["mcp.memory.write"],
      require_approval: ["bash"],
      deny: [],
    },
    network_egress: {
      default: "allow",
      allow: [],
      require_approval: [],
      deny: [],
    },
    secrets: {
      default: "allow",
      allow: [],
      require_approval: [],
      deny: [],
    },
  });
}

export function makeApprovalConfig(): Record<string, unknown> {
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

export function rememberOpsDecision(latestUserText: string) {
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

export async function waitForPendingApproval(container: GatewayContainer): Promise<{
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

export async function readMarkerFile(markerPath: string): Promise<string> {
  try {
    return await readFile(markerPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export function assistantMessages(
  conversation: Awaited<ReturnType<GatewayContainer["conversationDal"]["getById"]>> | undefined,
): string[] {
  return (
    conversation?.transcript.flatMap((item) =>
      item.kind === "text" && item.role === "assistant" ? [item.content] : [],
    ) ?? []
  );
}

export function createExecutionApprovalModel(input: {
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
