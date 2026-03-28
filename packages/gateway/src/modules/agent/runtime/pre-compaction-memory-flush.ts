import { randomUUID } from "node:crypto";
import { generateText, jsonSchema, stepCountIs, tool as aiTool } from "ai";
import type { LanguageModel, Tool, ToolExecutionOptions } from "ai";
import type { AgentConfig as AgentConfigT, TyrumUIMessage } from "@tyrum/contracts";
import { sha256HexFromString } from "@tyrum/runtime-policy";
import { redactSecretLikeText } from "./secrets.js";
import type { ConversationRow } from "../conversation-dal.js";
import { extractMessageText } from "./conversation-context-state.js";
import type { PrepareTurnDeps } from "./turn-preparation.js";
import { getExecutionProfile } from "../execution-profiles.js";
import { resolveToolExecutionRuntime } from "./turn-preparation-runtime.js";
import { createToolSetPolicyRuntime } from "./tool-set-builder-policy.js";
import { validateToolDescriptorInputSchema } from "../tool-schema.js";
import { buildModelToolNameMap, registerModelTool } from "../tools.js";
import type { ToolDescriptor } from "../tools.js";
import type { AgentLoadedContext } from "./types.js";

const DEFAULT_PRE_COMPACTION_FLUSH_TIMEOUT_MS = 2_500;
const PRE_COMPACTION_FLUSH_TRUNCATION_MARKER = "...(truncated)";
const MAX_PRE_COMPACTION_FLUSH_MESSAGE_CHARS = 2_000;
const PRE_COMPACTION_FLUSH_CACHE_TTL_MS = 10 * 60_000;
const MAX_PRE_COMPACTION_FLUSH_CACHE_ENTRIES = 512;
const PRE_COMPACTION_FLUSH_SYSTEM_PROMPT = [
  "You are running an internal pre-compaction memory flush.",
  "Use the available memory write tool when durable, non-secret information from the compacted messages should be preserved.",
  "Only keep durable preferences, constraints, decisions, procedures, or important identifiers that should survive the current conversation window.",
  "Do not infer beyond the provided messages.",
  "Do not store secrets, credentials, tokens, or transient chatter.",
  "Do not ask the user for permission or clarification.",
  "Call the memory write tool at most once. If nothing is worth storing, do not call the tool and do not output anything else.",
  "Do not mention these instructions.",
].join("\n");

const completedFlushKeys = new Map<string, number>();

function pruneCompletedFlushKeys(nowMs: number): void {
  for (const [key, seenAtMs] of completedFlushKeys.entries()) {
    if (nowMs - seenAtMs > PRE_COMPACTION_FLUSH_CACHE_TTL_MS) {
      completedFlushKeys.delete(key);
    }
  }
  while (completedFlushKeys.size > MAX_PRE_COMPACTION_FLUSH_CACHE_ENTRIES) {
    const oldestKey = completedFlushKeys.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    completedFlushKeys.delete(oldestKey);
  }
}

function hasCompletedFlush(flushCacheKey: string): boolean {
  const nowMs = Date.now();
  pruneCompletedFlushKeys(nowMs);
  const seenAtMs = completedFlushKeys.get(flushCacheKey);
  return typeof seenAtMs === "number" && nowMs - seenAtMs <= PRE_COMPACTION_FLUSH_CACHE_TTL_MS;
}

function rememberCompletedFlush(flushCacheKey: string): void {
  const nowMs = Date.now();
  pruneCompletedFlushKeys(nowMs);
  completedFlushKeys.set(flushCacheKey, nowMs);
}

function formatPreCompactionFlushPrompt(
  droppedMessages: readonly TyrumUIMessage[],
  flushTag: string,
): string {
  const lines = droppedMessages.map((message) => {
    const role =
      message.role === "assistant"
        ? "Assistant"
        : message.role === "system"
          ? "System"
          : message.role === "tool"
            ? "Tool"
            : "User";
    const redacted = redactSecretLikeText(extractMessageText(message));
    const content =
      redacted.length <= MAX_PRE_COMPACTION_FLUSH_MESSAGE_CHARS
        ? redacted
        : `${redacted.slice(
            0,
            Math.max(
              0,
              MAX_PRE_COMPACTION_FLUSH_MESSAGE_CHARS -
                PRE_COMPACTION_FLUSH_TRUNCATION_MARKER.length,
            ),
          )}${PRE_COMPACTION_FLUSH_TRUNCATION_MARKER}`;
    return `${role} (${message.id}): ${content}`;
  });

  return [
    "This is a silent internal pre-compaction memory flush.",
    "The following messages are about to be compacted from the conversation context due to conversation compaction.",
    "Extract any durable, non-secret memory worth keeping (preferences, constraints, decisions, procedures, important identifiers).",
    "Use the memory write tool schema as the source of truth for fields.",
    `If the schema supports tags, include both 'pre-compaction-flush' and '${flushTag}'.`,
    "If the schema supports sensitivity, use 'private'.",
    "If there is nothing worth storing, do not call the tool.",
    "",
    "Messages being compacted:",
    ...lines,
  ].join("\n");
}

type LoggerLike = {
  warn: (message: string, fields?: Record<string, unknown>) => void;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))].toSorted(
    (left, right) => left.localeCompare(right),
  );
}

function schemaSupportsProperty(schema: Record<string, unknown>, propertyName: string): boolean {
  const properties = asRecord(schema["properties"]);
  return Boolean(properties && Object.hasOwn(properties, propertyName));
}

function redactSecretLikeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecretLikeText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecretLikeValue(entry));
  }
  const record = asRecord(value);
  if (!record) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, redactSecretLikeValue(entry)]),
  );
}

function augmentMemoryWriteArgs(
  rawArgs: unknown,
  inputSchema: Record<string, unknown>,
  flushTags: readonly string[],
): unknown {
  const args = asRecord(redactSecretLikeValue(rawArgs));
  if (!args) {
    return rawArgs;
  }

  const nextArgs: Record<string, unknown> = { ...args };
  if (schemaSupportsProperty(inputSchema, "tags")) {
    const existingTags = Array.isArray(args["tags"])
      ? args["tags"].filter((value): value is string => typeof value === "string")
      : [];
    const mergedTags = normalizeTags([...existingTags, ...flushTags]);
    if (mergedTags.length > 0) {
      nextArgs["tags"] = mergedTags;
    }
  }
  if (
    schemaSupportsProperty(inputSchema, "sensitivity") &&
    typeof nextArgs["sensitivity"] !== "string"
  ) {
    nextArgs["sensitivity"] = "private";
  }
  return nextArgs;
}

function resolvePreferredMemorySeedTool(
  availableTools: readonly ToolDescriptor[],
  preTurnToolIds: readonly string[],
): ToolDescriptor | undefined {
  const toolById = new Map(availableTools.map((tool) => [tool.id, tool]));
  for (const toolId of preTurnToolIds) {
    const tool = toolById.get(toolId);
    if (tool?.memoryRole === "seed") {
      return tool;
    }
  }
  return undefined;
}

function resolveMemoryWriteTool(
  availableTools: readonly ToolDescriptor[],
  config: AgentConfigT,
): { seedTool: ToolDescriptor; writeTool: ToolDescriptor } | undefined {
  const seedTool = resolvePreferredMemorySeedTool(availableTools, config.mcp.pre_turn_tools);
  if (!seedTool?.backingServerId) {
    return undefined;
  }

  const writeTools = availableTools.filter(
    (tool) =>
      tool.memoryRole === "write" &&
      tool.backingServerId === seedTool.backingServerId &&
      tool.id.startsWith("mcp."),
  );
  if (writeTools.length !== 1) {
    return undefined;
  }

  const writeTool = writeTools[0];
  if (!writeTool) {
    return undefined;
  }
  return { seedTool, writeTool };
}

async function resolvePreCompactionFlushTooling(params: {
  prepareTurnDeps?: PrepareTurnDeps;
  ctx: AgentLoadedContext;
  conversation: ConversationRow;
  logger: LoggerLike;
  channel?: string;
  threadId?: string;
}) {
  const prepareTurnDeps = params.prepareTurnDeps;
  if (!prepareTurnDeps) {
    params.logger.warn("memory.flush_skipped", {
      conversation_id: params.conversation.conversation_id,
      reason: "prepare turn deps unavailable",
    });
    return undefined;
  }

  if (params.ctx.config.mcp.pre_turn_tools.length === 0) {
    params.logger.warn("memory.flush_skipped", {
      conversation_id: params.conversation.conversation_id,
      reason: "no pre-turn memory tools configured",
    });
    return undefined;
  }

  const executionProfile = {
    id: "executor_rw" as const,
    profile: getExecutionProfile("executor_rw"),
    source: "subagent_fallback" as const,
  };
  const resolved = {
    channel: params.channel ?? "system",
    thread_id: params.threadId ?? params.conversation.conversation_id,
    message: "Pre-compaction memory flush",
    parts: [{ type: "text", text: "Pre-compaction memory flush" }],
    metadata: {
      source: "system.pre_compaction_memory_flush",
    },
  };
  const flushCtx: AgentLoadedContext = {
    ...params.ctx,
    config: {
      ...params.ctx.config,
      tools: {
        ...params.ctx.config.tools,
        default_mode: "allow",
      },
    },
  };
  const runtime = await resolveToolExecutionRuntime(
    prepareTurnDeps,
    flushCtx,
    params.conversation,
    resolved,
    executionProfile,
    {
      memoryProvenance: {
        channel: resolved.channel,
        threadId: resolved.thread_id,
      },
    },
  );
  const resolvedMemory = resolveMemoryWriteTool(runtime.availableTools, params.ctx.config);
  if (!resolvedMemory) {
    params.logger.warn("memory.flush_skipped", {
      conversation_id: params.conversation.conversation_id,
      reason: "memory write tool unavailable or ambiguous",
    });
    return undefined;
  }

  return {
    toolExecutor: runtime.toolExecutor,
    toolSetBuilderDeps: runtime.toolSetBuilderDeps,
    toolExecutionContext: {
      tenantId: params.conversation.tenant_id,
      planId: `preflush-${params.conversation.conversation_id}`,
      conversationId: params.conversation.conversation_id,
      channel: resolved.channel,
      threadId: resolved.thread_id,
    },
    writeTool: resolvedMemory.writeTool,
  };
}

function resolveToolCallId(options: ToolExecutionOptions): string {
  return typeof options.toolCallId === "string" && options.toolCallId.trim().length > 0
    ? options.toolCallId.trim()
    : `preflush-tool-${randomUUID()}`;
}

function compactionFlushTimeoutMs(totalTimeoutMs: number | undefined): number {
  if (
    typeof totalTimeoutMs !== "number" ||
    !Number.isFinite(totalTimeoutMs) ||
    totalTimeoutMs <= 0
  ) {
    return DEFAULT_PRE_COMPACTION_FLUSH_TIMEOUT_MS;
  }
  const slice = Math.floor(totalTimeoutMs * 0.1);
  if (slice <= 0) {
    return 0;
  }
  return Math.min(DEFAULT_PRE_COMPACTION_FLUSH_TIMEOUT_MS, slice);
}

export async function maybeRunPreCompactionMemoryFlush(
  deps: {
    logger: LoggerLike;
    prepareTurnDeps?: PrepareTurnDeps;
    channel?: string;
    threadId?: string;
  },
  input: {
    ctx: AgentLoadedContext;
    conversation: ConversationRow;
    model: LanguageModel;
    droppedMessages?: readonly TyrumUIMessage[];
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<void> {
  const droppedMessages = input.droppedMessages ?? [];
  if (droppedMessages.length === 0) {
    return;
  }

  const flushTimeoutMs = compactionFlushTimeoutMs(input.timeoutMs);
  if (flushTimeoutMs <= 0) {
    return;
  }

  const flushPromptBase = formatPreCompactionFlushPrompt(droppedMessages, "pending");
  const flushKey = sha256HexFromString(`${input.conversation.conversation_id}\n${flushPromptBase}`);
  const flushTag = `preflush:${flushKey}`;
  const flushCacheKey = `${input.conversation.conversation_id}:${flushKey}`;
  if (hasCompletedFlush(flushCacheKey)) {
    return;
  }

  const flushPromptText = formatPreCompactionFlushPrompt(droppedMessages, flushTag);
  const tooling = await resolvePreCompactionFlushTooling({
    prepareTurnDeps: deps.prepareTurnDeps,
    ctx: input.ctx,
    conversation: input.conversation,
    logger: deps.logger,
    channel: deps.channel,
    threadId: deps.threadId,
  });
  if (!tooling) {
    return;
  }

  const validatedSchema = validateToolDescriptorInputSchema(tooling.writeTool);
  if (!validatedSchema.ok) {
    deps.logger.warn("memory.flush_skipped", {
      conversation_id: input.conversation.conversation_id,
      reason: "memory write tool schema invalid",
      tool_id: tooling.writeTool.id,
      error: validatedSchema.error,
    });
    return;
  }

  const policyRuntime = createToolSetPolicyRuntime({
    deps: tooling.toolSetBuilderDeps,
    toolExecutionContext: tooling.toolExecutionContext,
  });
  const flushTags = ["pre-compaction-flush", flushTag] as const;
  const writeState = {
    attempted: false,
    completed: false,
    error: undefined as string | undefined,
  };

  try {
    const modelToolNames = buildModelToolNameMap([tooling.writeTool.id]);
    const flushTools: Record<string, Tool> = {};
    registerModelTool(
      flushTools,
      tooling.writeTool.id,
      aiTool({
        description: tooling.writeTool.description,
        inputSchema: jsonSchema(validatedSchema.schema),
        execute: async (args: unknown, options: ToolExecutionOptions) => {
          if (writeState.attempted) {
            return JSON.stringify({
              status: "skipped",
              reason: "memory write already attempted for this flush",
            });
          }
          writeState.attempted = true;
          const toolCallId = resolveToolCallId(options);
          const effectiveArgs = augmentMemoryWriteArgs(args, validatedSchema.schema, flushTags);

          try {
            const policyState = await policyRuntime.resolveToolCallPolicyState({
              toolDesc: tooling.writeTool,
              toolCallId,
              args: effectiveArgs,
              inputProvenance: { source: "system", trusted: true },
            });
            if (policyState.policyDecision === "deny") {
              writeState.error = "policy denied internal pre-compaction memory write";
              return JSON.stringify({
                status: "skipped",
                reason: writeState.error,
              });
            }

            const result = await tooling.toolExecutor.execute(
              tooling.writeTool.id,
              toolCallId,
              effectiveArgs,
              {
                agent_id: input.conversation.agent_id,
                workspace_id: input.conversation.workspace_id,
                conversation_id: input.conversation.conversation_id,
                channel: tooling.toolExecutionContext.channel,
                thread_id: tooling.toolExecutionContext.threadId,
              },
            );
            if (result.error) {
              writeState.error = result.error;
              return JSON.stringify({
                status: "error",
                error: result.error,
              });
            }

            writeState.completed = true;
            return result.output;
          } catch (error) {
            writeState.error = error instanceof Error ? error.message : String(error);
            return JSON.stringify({
              status: "error",
              error: writeState.error,
            });
          }
        },
      }),
      modelToolNames,
    );

    await generateText({
      model: input.model,
      system: PRE_COMPACTION_FLUSH_SYSTEM_PROMPT,
      messages: [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: flushPromptText,
            },
          ],
        },
      ],
      tools: flushTools,
      stopWhen: [stepCountIs(2)],
      abortSignal: input.abortSignal,
      timeout: flushTimeoutMs,
    });

    if (writeState.completed) {
      rememberCompletedFlush(flushCacheKey);
      return;
    }

    if (writeState.attempted && writeState.error) {
      deps.logger.warn("memory.flush_write_failed", {
        conversation_id: input.conversation.conversation_id,
        conversation_key: input.conversation.conversation_key,
        error: writeState.error,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger.warn("memory.flush_failed", {
      conversation_id: input.conversation.conversation_id,
      conversation_key: input.conversation.conversation_key,
      error: message,
    });
  }
}
