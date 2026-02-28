import { randomUUID } from "node:crypto";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { generateText, jsonSchema, stepCountIs, streamText, tool as aiTool } from "ai";
import type { LanguageModel, ModelMessage, Tool, ToolExecutionOptions, ToolSet } from "ai";
import type {
  AgentStatusResponse as AgentStatusResponseT,
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
  AgentConfig as AgentConfigT,
  McpServerSpec as McpServerSpecT,
  IdentityPack as IdentityPackT,
  NormalizedAttachment as NormalizedAttachmentT,
  NormalizedMessageEnvelope as NormalizedMessageEnvelopeT,
  NormalizedContainerKind,
  SecretHandle as SecretHandleT,
} from "@tyrum/schemas";
import {
  AgentId,
  AgentStatusResponse,
  AgentTurnResponse,
  ContextReport as ContextReportSchema,
  SubagentSessionKey,
  WorkspaceId,
} from "@tyrum/schemas";
import type { Decision } from "@tyrum/schemas";
import {
  prepareLaneQueueStep as prepareLaneQueueStepBridge,
  turnViaExecutionEngine as turnViaExecutionEngineBridge,
  type LaneQueueScope,
  type LaneQueueState,
  type TurnEngineBridgeDeps,
} from "./turn-engine-bridge.js";
import {
  DATA_TAG_SAFETY_PROMPT,
  formatIdentityPrompt,
  formatSessionContext,
  formatSkillsPrompt,
  formatToolPrompt,
} from "./prompts.js";
import {
  buildProviderResolutionSetup,
  listOrderedEligibleProfilesForProvider,
  parseProviderModelId,
  resolveEnvApiKey,
  resolveProfileApiKey,
  resolveProviderBaseURL,
} from "./provider-resolution.js";
import { resolveSessionModel as resolveSessionModelImpl } from "./session-model-resolution.js";
import { looksLikeSecretText, redactSecretLikeText } from "./secrets.js";
import type { AgentContextReport, AgentRuntimeOptions } from "./types.js";
import { ensureWorkspaceInitialized, resolveTyrumHome } from "../home.js";
import {
  decideCrossTurnLoopWarning,
  detectWithinTurnToolLoop,
  LOOP_WARNING_PREFIX,
} from "../loop-detection.js";
import { MarkdownMemoryStore } from "../markdown-memory.js";
import { SessionDal, type SessionMessage, type SessionRow } from "../session-dal.js";
import { buildAgentTurnKey } from "../turn-key.js";
import {
  loadAgentConfig,
  loadEnabledMcpServers,
  loadEnabledSkills,
  loadIdentity,
  type LoadedSkillManifest,
} from "../workspace.js";
import { isToolAllowed, selectToolDirectory, type ToolDescriptor } from "../tools.js";
import { getExecutionProfile, normalizeExecutionProfileId } from "../execution-profiles.js";
import type { ExecutionProfile, ExecutionProfileId } from "../execution-profiles.js";
import { IntakeModeOverrideDal } from "../intake-mode-override-dal.js";
import { McpManager } from "../mcp-manager.js";
import { NodeDispatchService } from "../node-dispatch-service.js";
import { ToolExecutor, type ToolResult } from "../tool-executor.js";
import { tagContent } from "../provenance.js";
import { sanitizeForModel, containsInjectionPatterns } from "../sanitizer.js";
import { EnvSecretProvider } from "../../secret/provider.js";
import { collectSecretHandleIds } from "../../secret/collect-secret-handle-ids.js";
import { VectorDal } from "../../memory/vector-dal.js";
import { EmbeddingPipeline } from "../../memory/embedding-pipeline.js";
import { MemoryV1Dal } from "../../memory/v1-dal.js";
import { buildMemoryV1Digest } from "../../memory/v1-digest.js";
import { recordMemoryV1SystemEpisode } from "../../memory/v1-episode-recorder.js";
import {
  MemoryV1SemanticIndex,
  type MemoryV1SemanticSearchHit,
} from "../../memory/v1-semantic-index.js";
import type { ApprovalNotifier } from "../../approval/notifier.js";
import type { ApprovalDal, ApprovalStatus } from "../../approval/dal.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "../../policy/service.js";
import { canonicalizeToolMatchTarget } from "../../policy/match-target.js";
import { suggestedOverridesForToolCall } from "../../policy/suggested-overrides.js";
import { sha256HexFromString } from "../../policy/canonical-json.js";
import { wildcardMatch } from "../../policy/wildcard.js";
import { createProviderFromNpm } from "../../models/provider-factory.js";
import {
  appendToolApprovalResponseMessage,
  coerceModelMessages,
  countAssistantMessages,
  hasToolResult,
} from "../../ai-sdk/message-utils.js";
import { coerceRecord } from "../../util/coerce.js";
import { ExecutionEngine } from "../../execution/engine.js";
import { resolveSandboxHardeningProfile } from "../../sandbox/hardening.js";
import { deriveElevatedExecutionAvailableFromPolicyBundle } from "../../sandbox/elevated-execution.js";
import { LaneQueueSignalDal, LaneQueueInterruptError } from "../../lanes/queue-signal-dal.js";
import { resolveWorkspaceId } from "../../workspace/id.js";
import { WorkboardDal } from "../../workboard/dal.js";

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_APPROVAL_WAIT_MS = 120_000;
const DEFAULT_APPROVAL_POLL_MS = 500;
const MAX_TURN_ENGINE_WAIT_MS = 60_000;

const DEFAULT_PRE_COMPACTION_FLUSH_TIMEOUT_MS = 2_500;
const PRE_COMPACTION_FLUSH_TRUNCATION_MARKER = "...(truncated)";
const MAX_PRE_COMPACTION_FLUSH_MESSAGE_CHARS = 2_000;

const WITHIN_TURN_LOOP_STOP_REPLY =
  "Loop detected (repeated tool calls); stopping to avoid runaway execution. " +
  "If you want me to continue, adjust the request/constraints or ask me to try a different approach.";

const CROSS_TURN_LOOP_WARNING_TEXT =
  `${LOOP_WARNING_PREFIX} I may be repeating myself. If this isn’t progressing, tell me what to change ` +
  "(goal/constraints/example output) and I’ll take a different approach.";

function createStaticLanguageModelV3(text: string): LanguageModelV3 {
  const finishReason = { unified: "stop" as const, raw: "stop" };
  const usage = {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };

  return {
    specificationVersion: "v3",
    provider: "tyrum",
    modelId: "static",
    supportedUrls: {},
    doGenerate: async (
      _options: LanguageModelV3CallOptions,
    ): Promise<LanguageModelV3GenerateResult> => {
      return {
        content: [{ type: "text", text }],
        finishReason,
        usage,
        warnings: [],
      };
    },
    doStream: async (
      _options: LanguageModelV3CallOptions,
    ): Promise<LanguageModelV3StreamResult> => {
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            const id = randomUUID();
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id });
            controller.enqueue({ type: "text-delta", id, delta: text });
            controller.enqueue({ type: "text-end", id });
            controller.enqueue({ type: "finish", usage, finishReason });
            controller.close();
          },
        }),
      };
    },
  };
}

type StepPauseRequest = {
  kind: string;
  prompt: string;
  detail: string;
  context?: unknown;
  expiresAt?: string | null;
};

class ToolExecutionApprovalRequiredError extends Error {
  constructor(public readonly pause: StepPauseRequest) {
    super(pause.prompt);
    this.name = "ToolExecutionApprovalRequiredError";
  }
}

type ToolApprovalResumeState = {
  approval_id: string;
  messages: ModelMessage[];
  used_tools?: string[];
  steps_used?: number;
};

function coerceSecretHandle(value: unknown): SecretHandleT | undefined {
  const record = coerceRecord(value);
  if (!record) return undefined;
  const handleId = typeof record["handle_id"] === "string" ? record["handle_id"].trim() : "";
  const provider = typeof record["provider"] === "string" ? record["provider"].trim() : "";
  const scope = typeof record["scope"] === "string" ? record["scope"].trim() : "";
  const createdAt = typeof record["created_at"] === "string" ? record["created_at"].trim() : "";
  if (!handleId || !provider || !scope || !createdAt) return undefined;
  if (provider !== "env" && provider !== "file" && provider !== "keychain") return undefined;
  return {
    handle_id: handleId,
    provider,
    scope,
    created_at: createdAt,
  };
}

function extractToolApprovalResumeState(context: unknown): ToolApprovalResumeState | undefined {
  const record = coerceRecord(context);
  if (!record) return undefined;
  if (record["source"] !== "agent-tool-execution") return undefined;
  const ai = coerceRecord(record["ai_sdk"]);
  if (!ai) return undefined;
  const approvalId = typeof ai["approval_id"] === "string" ? ai["approval_id"].trim() : "";
  if (approvalId.length === 0) return undefined;
  const messages = coerceModelMessages(ai["messages"]);
  if (!messages) return undefined;
  const usedToolsRaw = ai["used_tools"];
  const usedTools = Array.isArray(usedToolsRaw)
    ? usedToolsRaw.filter((value): value is string => typeof value === "string")
    : undefined;

  const stepsUsedRaw = ai["steps_used"];
  const stepsUsed =
    typeof stepsUsedRaw === "number" &&
    Number.isFinite(stepsUsedRaw) &&
    Number.isSafeInteger(stepsUsedRaw) &&
    stepsUsedRaw >= 0
      ? stepsUsedRaw
      : undefined;

  return { approval_id: approvalId, messages, used_tools: usedTools, steps_used: stepsUsed };
}

async function deriveElevatedExecutionAvailable(
  policyService: PolicyService,
): Promise<boolean | null> {
  try {
    const effective = await policyService.loadEffectiveBundle();
    return deriveElevatedExecutionAvailableFromPolicyBundle(effective.bundle);
  } catch {
    // Intentional: policy bundle load is best-effort for prompt context; treat failures as unknown.
    return null;
  }
}

interface AgentLoadedContext {
  config: AgentConfigT;
  identity: IdentityPackT;
  skills: LoadedSkillManifest[];
  mcpServers: McpServerSpecT[];
  memoryStore: MarkdownMemoryStore;
}

interface ToolExecutionContext {
  planId: string;
  sessionId: string;
  channel: string;
  threadId: string;
  execution?: {
    runId: string;
    stepIndex: number;
    stepId: string;
    stepApprovalId?: number;
  };
}

type TurnExecutionContext = {
  planId: string;
  runId: string;
  stepIndex: number;
  stepId: string;
  stepApprovalId?: number;
};

type ToolCallPolicyState = {
  toolDesc: ToolDescriptor;
  toolCallId: string;
  args: unknown;
  matchTarget: string;
  inputProvenance: { source: string; trusted: boolean };
  policyDecision?: Decision;
  policySnapshotId?: string;
  appliedOverrideIds?: string[];
  suggestedOverrides?:
    | Array<{ tool_id: string; pattern: string; workspace_id: string }>
    | undefined;
  approvalStepIndex?: number;
  shouldRequireApproval: boolean;
};

function resolveAgentId(): string {
  const raw = process.env["TYRUM_AGENT_ID"]?.trim();
  return raw && raw.length > 0 ? raw : "default";
}

function resolveTurnRequestId(input: AgentTurnRequestT): string {
  const raw = input.metadata?.["request_id"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return `agent-turn-${randomUUID()}`;
}

type ResolvedAgentTurnInput = {
  channel: string;
  thread_id: string;
  message: string;
  envelope?: NormalizedMessageEnvelopeT;
  metadata?: Record<string, unknown>;
};

type ResolvedExecutionProfile = {
  id: ExecutionProfileId;
  profile: ExecutionProfile;
  source: "interaction_default" | "subagent_record" | "subagent_fallback";
};

function formatNormalizedAttachment(attachment: NormalizedAttachmentT): string {
  const fields = [`kind=${attachment.kind}`];
  if (attachment.mime_type) fields.push(`mime_type=${attachment.mime_type}`);
  if (typeof attachment.size_bytes === "number")
    fields.push(`size_bytes=${String(attachment.size_bytes)}`);
  if (attachment.sha256) fields.push(`sha256=${attachment.sha256}`);
  return `- ${fields.join(" ")}`;
}

function formatAttachmentSummary(attachments: NormalizedAttachmentT[]): string | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  return `Attachments:\n${attachments.map(formatNormalizedAttachment).join("\n")}`;
}

function resolveAgentTurnInput(input: AgentTurnRequestT): ResolvedAgentTurnInput {
  const envelope = input.envelope;
  const channel = envelope?.delivery.channel ?? input.channel;
  const threadId = envelope?.container.id ?? input.thread_id;

  if (typeof channel !== "string" || channel.trim().length === 0) {
    throw new Error("channel is required");
  }
  if (typeof threadId !== "string" || threadId.trim().length === 0) {
    throw new Error("thread_id is required");
  }

  const baseText = (input.message ?? envelope?.content.text ?? "").trim();
  const attachmentsSummary = envelope
    ? formatAttachmentSummary(envelope.content.attachments)
    : undefined;
  const message = [baseText, attachmentsSummary]
    .filter((part) => part && part.trim().length > 0)
    .join("\n\n")
    .trim();

  if (message.length === 0) {
    throw new Error("message is required (either message text or envelope content)");
  }

  return {
    channel,
    thread_id: threadId,
    message,
    envelope,
    metadata: input.metadata,
  };
}

function resolveLaneQueueScope(
  metadata: Record<string, unknown> | undefined,
): LaneQueueScope | undefined {
  if (!metadata) return undefined;

  const rawKey = metadata["tyrum_key"];
  const rawLane = metadata["lane"];

  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  const lane = typeof rawLane === "string" ? rawLane.trim() : "";
  if (key.length === 0 || lane.length === 0) return undefined;

  return { key, lane };
}

function resolveMainLaneSessionKey(input: {
  agentId: string;
  workspaceId: string;
  resolved: ResolvedAgentTurnInput;
  containerKind: NormalizedContainerKind;
  deliveryAccount?: string;
}): string {
  const laneQueueScope = resolveLaneQueueScope(input.resolved.metadata);
  if (laneQueueScope?.lane === "main") {
    return laneQueueScope.key;
  }

  return buildAgentTurnKey({
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    channel: input.resolved.channel,
    containerKind: input.containerKind,
    threadId: input.resolved.thread_id,
    deliveryAccount: input.deliveryAccount,
  });
}

function shouldPromoteToCoreMemory(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("i prefer") ||
    normalized.includes("remember that") ||
    normalized.includes("always ") ||
    normalized.includes("never ")
  );
}

const NOOP_APPROVAL_NOTIFIER: ApprovalNotifier = {
  notify(_approval) {
    // no-op
  },
};

function isSideEffectingPluginTool(tool: ToolDescriptor): boolean {
  const id = tool.id.trim();
  return id.startsWith("plugin.") && tool.requires_confirmation;
}

function isStatusQuery(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized === "status?" || normalized === "status";
}

type IntakeMode = "delegate_execute" | "delegate_plan";

type IntakeModeDecision = {
  mode: IntakeMode;
  reason_code: string;
  body: string;
};

function stripDirectivePrefix(message: string, prefix: string): string {
  let rest = message.slice(prefix.length);
  if (rest.startsWith(":")) rest = rest.slice(1);
  return rest.trim();
}

function isDirectiveInvocation(message: string, prefix: string): boolean {
  if (!message.startsWith(prefix)) return false;
  if (message.length === prefix.length) return true;
  const next = message[prefix.length];
  return next === ":" || next === " " || next === "\t" || next === "\n" || next === "\r";
}

function parseIntakeModeDecision(message: string): IntakeModeDecision | undefined {
  const trimmed = message.trim();
  if (isDirectiveInvocation(trimmed, "/delegate_execute")) {
    return {
      mode: "delegate_execute",
      reason_code: "explicit_delegate_execute",
      body: stripDirectivePrefix(trimmed, "/delegate_execute"),
    };
  }
  if (isDirectiveInvocation(trimmed, "/delegate_plan")) {
    return {
      mode: "delegate_plan",
      reason_code: "explicit_delegate_plan",
      body: stripDirectivePrefix(trimmed, "/delegate_plan"),
    };
  }
  return undefined;
}

function deriveWorkItemTitle(body: string): string {
  const normalized = body.replaceAll(/\s+/g, " ").trim();
  if (!normalized) return "Delegated work";
  if (normalized.length <= 160) return normalized;
  return `${normalized.slice(0, 157)}...`;
}

export class AgentRuntime {
  private readonly home: string;
  private readonly sessionDal: SessionDal;
  private readonly fetchImpl: typeof fetch;
  private readonly agentId: string;
  private readonly workspaceId: string;
  private readonly instanceOwner: string;
  private readonly languageModelOverride?: LanguageModel;
  private readonly mcpManager: McpManager;
  private plugins: PluginRegistry | undefined;
  private readonly policyService: PolicyService;
  private readonly approvalDal: ApprovalDal;
  private readonly approvalNotifier: ApprovalNotifier;
  private readonly approvalWaitMs: number;
  private readonly approvalPollMs: number;
  private readonly maxSteps: number;
  private readonly executionEngine: ExecutionEngine;
  private readonly executionWorkerId: string;
  private readonly turnEngineWaitMs: number;
  private lastContextReport: AgentContextReport | undefined;
  private cleanupAtMs = 0;

  private getWorkScope(): { tenant_id: "default"; agent_id: string; workspace_id: string } {
    return { tenant_id: "default", agent_id: this.agentId, workspace_id: this.workspaceId };
  }

  private async buildWorkFocusDigest(): Promise<string> {
    const scope = this.getWorkScope();
    try {
      const workboard = new WorkboardDal(
        this.opts.container.db,
        this.opts.container.redactionEngine,
      );
      const [{ items: doing }, { items: blocked }, { items: ready }] = await Promise.all([
        workboard.listItems({ scope, statuses: ["doing"], limit: 3 }),
        workboard.listItems({ scope, statuses: ["blocked"], limit: 3 }),
        workboard.listItems({ scope, statuses: ["ready"], limit: 3 }),
      ]);

      if (doing.length === 0 && blocked.length === 0 && ready.length === 0) {
        return "No active WorkItems.";
      }

      const lines: string[] = [];
      if (doing.length > 0) {
        lines.push("Doing:");
        for (const item of doing) {
          lines.push(`- ${item.work_item_id} — ${item.title}`);
        }
      }
      if (blocked.length > 0) {
        lines.push("Blocked:");
        for (const item of blocked) {
          lines.push(`- ${item.work_item_id} — ${item.title}`);
        }
      }
      if (ready.length > 0) {
        lines.push("Ready:");
        for (const item of ready) {
          lines.push(`- ${item.work_item_id} — ${item.title}`);
        }
      }

      return lines.join("\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.container.logger.warn("workboard.focus_digest_failed", { error: message });
      return "Work focus digest unavailable.";
    }
  }

  constructor(private readonly opts: AgentRuntimeOptions) {
    this.home = opts.home ?? resolveTyrumHome();
    this.sessionDal = opts.sessionDal ?? opts.container.sessionDal;
    this.fetchImpl = opts.fetchImpl ?? fetch;

    const agentIdCandidate = opts.agentId?.trim() || resolveAgentId();
    const parsedAgentId = AgentId.safeParse(agentIdCandidate);
    if (!parsedAgentId.success) {
      throw new Error(`invalid agent_id '${agentIdCandidate}' (${parsedAgentId.error.message})`);
    }
    this.agentId = parsedAgentId.data;

    const workspaceIdCandidate = opts.workspaceId?.trim() || resolveWorkspaceId();
    const parsedWorkspaceId = WorkspaceId.safeParse(workspaceIdCandidate);
    if (!parsedWorkspaceId.success) {
      throw new Error(
        `invalid workspace_id '${workspaceIdCandidate}' (${parsedWorkspaceId.error.message})`,
      );
    }
    this.workspaceId = parsedWorkspaceId.data;
    this.instanceOwner = process.env["TYRUM_INSTANCE_ID"]?.trim() || `instance-${randomUUID()}`;
    this.languageModelOverride = opts.languageModel;
    this.mcpManager = opts.mcpManager ?? new McpManager({ logger: opts.container.logger });
    this.plugins = opts.plugins;
    this.policyService = opts.policyService ?? opts.container.policyService;
    this.approvalDal = opts.approvalDal ?? opts.container.approvalDal;
    this.approvalNotifier = opts.approvalNotifier ?? NOOP_APPROVAL_NOTIFIER;
    this.approvalWaitMs = Math.max(1_000, opts.approvalWaitMs ?? DEFAULT_APPROVAL_WAIT_MS);
    this.approvalPollMs = Math.max(100, opts.approvalPollMs ?? DEFAULT_APPROVAL_POLL_MS);
    this.maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
    this.turnEngineWaitMs = Math.max(1, opts.turnEngineWaitMs ?? MAX_TURN_ENGINE_WAIT_MS);
    this.executionEngine = new ExecutionEngine({
      db: opts.container.db,
      redactionEngine: opts.container.redactionEngine,
      logger: opts.container.logger,
    });
    this.executionWorkerId = `agent-runtime-${this.agentId}-${randomUUID()}`;
  }

  setPlugins(plugins: PluginRegistry): void {
    this.plugins = plugins;
  }

  async shutdown(): Promise<void> {
    await this.mcpManager.shutdown();
  }

  private async loadContext(): Promise<AgentLoadedContext> {
    await ensureWorkspaceInitialized(this.home);
    const config = await loadAgentConfig(this.home);
    const identity = await loadIdentity(this.home);
    const skills = await loadEnabledSkills(this.home, config, {
      logger: this.opts.container.logger,
    });
    const mcpServers = await loadEnabledMcpServers(this.home, config, {
      logger: this.opts.container.logger,
    });
    const memoryStore = new MarkdownMemoryStore(this.home);
    await memoryStore.ensureInitialized();

    return {
      config,
      identity,
      skills,
      mcpServers,
      memoryStore,
    };
  }

  private maybeCleanupSessions(ttlDays: number): void {
    const now = Date.now();
    if (now < this.cleanupAtMs) {
      return;
    }
    void this.sessionDal.deleteExpired(ttlDays, this.agentId);
    this.cleanupAtMs = now + 60 * 60 * 1000;
  }

  private async resolveSessionModel(input: {
    config: AgentConfigT;
    sessionId: string;
    profileModelId?: string;
    fetchImpl?: typeof fetch;
  }): Promise<LanguageModelV3> {
    return await resolveSessionModelImpl(
      {
        agentId: this.agentId,
        container: this.opts.container,
        languageModelOverride: this.languageModelOverride,
        secretProvider: this.opts.secretProvider,
        oauthLeaseOwner: this.instanceOwner,
        fetchImpl: this.fetchImpl,
      },
      input,
    );
  }

  async status(enabled: boolean): Promise<AgentStatusResponseT> {
    if (!enabled) {
      return AgentStatusResponse.parse({
        enabled: false,
        home: this.home,
        identity: {
          name: "disabled",
        },
        model: {
          model: "disabled/disabled",
        },
        skills: [],
        mcp: [],
        tools: [],
        sessions: {
          ttl_days: 30,
          max_turns: 20,
        },
      });
    }

    const ctx = await this.loadContext();
    const status = {
      enabled: true,
      home: this.home,
      identity: {
        name: ctx.identity.meta.name,
        description: ctx.identity.meta.description,
      },
      model: ctx.config.model,
      skills: ctx.skills.map((skill) => skill.meta.id),
      skills_detailed: ctx.skills.map((skill) => ({
        id: skill.meta.id,
        name: skill.meta.name,
        version: skill.meta.version,
        source: skill.provenance.source,
      })),
      workspace_skills_trusted: ctx.config.skills.workspace_trusted,
      mcp: ctx.mcpServers.map((server) => ({
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        transport: server.transport,
      })),
      tools: ctx.config.tools.allow,
      sessions: ctx.config.sessions,
    };

    return AgentStatusResponse.parse(status);
  }

  getLastContextReport(): AgentContextReport | undefined {
    return this.lastContextReport;
  }

  private prepareLaneQueueStep(
    laneQueue: LaneQueueState | undefined,
    messages: Array<ModelMessage>,
  ): { messages: Array<ModelMessage> } {
    return prepareLaneQueueStepBridge(laneQueue, messages);
  }

  private createStopWhenWithWithinTurnLoopDetection(input: {
    stepLimit: number;
    withinTurnCfg: {
      enabled: boolean;
      consecutive_repeat_limit: number;
      cycle_repeat_limit: number;
    };
    sessionId: string;
    channel: string;
    threadId: string;
  }): {
    stopWhen: Array<ReturnType<typeof stepCountIs>>;
    withinTurnLoop: { value: ReturnType<typeof detectWithinTurnToolLoop> | undefined };
  } {
    const withinTurnLoop = {
      value: undefined as ReturnType<typeof detectWithinTurnToolLoop> | undefined,
    };
    const stopWhen = [stepCountIs(input.stepLimit)];

    if (input.withinTurnCfg.enabled) {
      stopWhen.push(({ steps }) => {
        if (withinTurnLoop.value) return true;
        const detected = detectWithinTurnToolLoop({
          steps,
          consecutiveRepeatLimit: input.withinTurnCfg.consecutive_repeat_limit,
          cycleRepeatLimit: input.withinTurnCfg.cycle_repeat_limit,
        });
        if (!detected) return false;
        withinTurnLoop.value = detected;
        this.opts.container.logger.warn("agents.loop.within_turn_detected", {
          session_id: input.sessionId,
          channel: input.channel,
          thread_id: input.threadId,
          kind: detected.kind,
          tool_names: detected.toolNames,
        });
        return true;
      });
    }

    return { stopWhen, withinTurnLoop };
  }

  private resolveTurnReply(
    rawReply: string,
    withinTurnLoop: ReturnType<typeof detectWithinTurnToolLoop> | undefined,
  ): string {
    if (withinTurnLoop) {
      if (rawReply.trim().length === 0) return WITHIN_TURN_LOOP_STOP_REPLY;
      if (rawReply.includes(WITHIN_TURN_LOOP_STOP_REPLY)) return rawReply;
      return `${rawReply}\n\n${WITHIN_TURN_LOOP_STOP_REPLY}`;
    }
    if (rawReply.length > 0) return rawReply;
    return "No assistant response returned.";
  }

  async turnStream(input: AgentTurnRequestT): Promise<{
    streamResult: ReturnType<typeof streamText>;
    sessionId: string;
    finalize: () => Promise<AgentTurnResponseT>;
  }> {
    const prepared = await this.prepareTurn(input);
    const {
      ctx,
      executionProfile,
      session,
      mainLaneSessionKey,
      model,
      toolSet,
      laneQueue,
      usedTools,
      userContent,
      contextReport,
      systemPrompt,
      resolved,
    } = prepared;

    const intake = await this.resolveIntakeDecision({
      input,
      executionProfile,
      resolved,
      mainLaneSessionKey,
    });
    if (intake.mode === "delegate_execute" || intake.mode === "delegate_plan") {
      const delegation = await this.delegateFromIntake({
        executionProfile,
        mode: intake.mode,
        reason_code: intake.reason_code,
        resolved,
        createdFromSessionKey: mainLaneSessionKey,
      });
      const response = await this.finalizeTurn(
        ctx,
        session,
        resolved,
        delegation.reply,
        usedTools,
        contextReport,
      );

      const streamResult = streamText({
        model: createStaticLanguageModelV3(delegation.reply),
        system: "",
        messages: [
          {
            role: "user" as const,
            content: [{ type: "text", text: "" }],
          },
        ],
        stopWhen: [stepCountIs(1)],
      });

      return { streamResult, sessionId: session.session_id, finalize: async () => response };
    }

    await this.maybeRunPreCompactionMemoryFlush({
      ctx,
      session,
      model,
      systemPrompt,
    });

    const withinTurnCfg = ctx.config.sessions.loop_detection.within_turn;
    const { stopWhen, withinTurnLoop } = this.createStopWhenWithWithinTurnLoopDetection({
      stepLimit: this.maxSteps,
      withinTurnCfg,
      sessionId: session.session_id,
      channel: resolved.channel,
      threadId: resolved.thread_id,
    });

    const streamResult = streamText({
      model,
      system: systemPrompt,
      messages: [
        {
          role: "user" as const,
          content: userContent,
        },
      ],
      tools: toolSet,
      stopWhen,
      prepareStep: ({ messages }) => this.prepareLaneQueueStep(laneQueue, messages),
    });

    const finalize = async (): Promise<AgentTurnResponseT> => {
      const result = await streamResult;
      const rawReply = (await result.text) || "";
      const reply = this.resolveTurnReply(rawReply, withinTurnLoop.value);
      return await this.finalizeTurn(ctx, session, resolved, reply, usedTools, contextReport);
    };

    return { streamResult, sessionId: session.session_id, finalize };
  }

  async turn(input: AgentTurnRequestT): Promise<AgentTurnResponseT> {
    return await this.turnViaExecutionEngine(input);
  }

  private async maybeStoreToolApprovalArgsHandle(input: {
    toolId: string;
    toolCallId: string;
    args: unknown;
  }): Promise<SecretHandleT | undefined> {
    const secretProvider = this.opts.secretProvider;
    if (!secretProvider || secretProvider instanceof EnvSecretProvider) {
      return undefined;
    }

    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(input.args);
    } catch {
      // Intentional: tool approval args may be non-serializable (cycles/BigInt); skip persistence.
      serialized = undefined;
    }
    if (typeof serialized !== "string") {
      return undefined;
    }

    try {
      return await secretProvider.store(
        `tool_approval:${this.agentId}:${input.toolId}:${input.toolCallId}:args`,
        serialized,
      );
    } catch {
      // Intentional: approval args persistence is best-effort; skipping doesn't block tool execution.
      return undefined;
    }
  }

  private async turnDirect(
    input: AgentTurnRequestT,
    opts?: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: TurnExecutionContext },
  ): Promise<AgentTurnResponseT> {
    const prepared = await this.prepareTurn(input, opts?.execution);
    const {
      ctx,
      executionProfile,
      session,
      mainLaneSessionKey,
      model,
      toolSet,
      toolCallPolicyStates,
      laneQueue,
      usedTools,
      userContent,
      contextReport,
      systemPrompt,
      resolved,
    } = prepared;

    if (isStatusQuery(resolved.message)) {
      const scope = this.getWorkScope();
      let reply = "";
      try {
        const workboard = new WorkboardDal(
          this.opts.container.db,
          this.opts.container.redactionEngine,
        );
        const { items } = await workboard.listItems({
          scope,
          statuses: ["doing", "blocked", "ready", "backlog"],
          limit: 50,
        });
        if (items.length === 0) {
          reply = "WorkBoard status: no active work items.";
        } else {
          const lines: string[] = ["WorkBoard status:"];
          for (const item of items) {
            lines.push(`- [${item.status}] ${item.work_item_id} — ${item.title}`);
            const tasks = await workboard.listTasks({ scope, work_item_id: item.work_item_id });
            for (const task of tasks.slice(0, 10)) {
              lines.push(
                `  - task ${task.task_id} (${task.status}) profile=${task.execution_profile}`,
              );
            }
          }
          reply = lines.join("\n");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.opts.container.logger.warn("workboard.status_query_failed", { error: message });
        reply = "WorkBoard status is unavailable.";
      }

      return await this.finalizeTurn(ctx, session, resolved, reply, usedTools, contextReport);
    }

    const intakeModeDecision = parseIntakeModeDecision(resolved.message);
    if (intakeModeDecision) {
      const scope = this.getWorkScope();
      const createdFromSessionKeyRaw = resolved.metadata?.["work_session_key"];
      const createdFromSessionKey =
        typeof createdFromSessionKeyRaw === "string" ? createdFromSessionKeyRaw.trim() : "";
      if (!createdFromSessionKey) {
        throw new Error("missing work_session_key metadata for delegated work");
      }

      const workboard = new WorkboardDal(
        this.opts.container.db,
        this.opts.container.redactionEngine,
      );
      const title = deriveWorkItemTitle(intakeModeDecision.body);
      const kind = intakeModeDecision.mode === "delegate_plan" ? "initiative" : "action";

      const item = await workboard.createItem({
        scope,
        createdFromSessionKey,
        item: {
          kind,
          title,
          acceptance: {
            mode: intakeModeDecision.mode,
            reason_code: intakeModeDecision.reason_code,
            request: intakeModeDecision.body,
            source: { channel: resolved.channel, thread_id: resolved.thread_id },
          },
        },
      });

      await workboard.setStateKv({
        scope: { kind: "agent", ...scope },
        key: "work.active_work_item_id",
        value_json: item.work_item_id,
        provenance_json: {
          source: "agent-turn",
          mode: intakeModeDecision.mode,
          reason_code: intakeModeDecision.reason_code,
        },
      });

      await workboard.setStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: item.work_item_id },
        key: "work.intake",
        value_json: { mode: intakeModeDecision.mode, reason_code: intakeModeDecision.reason_code },
      });

      await workboard.createTask({
        scope,
        task: {
          work_item_id: item.work_item_id,
          status: "queued",
          execution_profile: intakeModeDecision.mode === "delegate_plan" ? "planner" : "executor",
          side_effect_class: "workspace",
        },
      });

      await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "ready" });
      try {
        await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "doing" });
      } catch {
        // Intentional: ignore WIP/transition errors; the WorkItem still exists for operator triage.
      }

      const reply = `Delegated work item created: ${item.work_item_id} (mode=${intakeModeDecision.mode}, reason=${intakeModeDecision.reason_code})`;
      return await this.finalizeTurn(ctx, session, resolved, reply, usedTools, contextReport);
    }

    const intake = await this.resolveIntakeDecision({
      input,
      executionProfile,
      resolved,
      mainLaneSessionKey,
    });
    if (intake.mode === "delegate_execute" || intake.mode === "delegate_plan") {
      const delegation = await this.delegateFromIntake({
        executionProfile,
        mode: intake.mode,
        reason_code: intake.reason_code,
        resolved,
        createdFromSessionKey: mainLaneSessionKey,
      });
      return await this.finalizeTurn(
        ctx,
        session,
        resolved,
        delegation.reply,
        usedTools,
        contextReport,
      );
    }

    await this.maybeRunPreCompactionMemoryFlush({
      ctx,
      session,
      model,
      systemPrompt,
      abortSignal: opts?.abortSignal,
      timeoutMs: opts?.timeoutMs,
    });

    let messages: ModelMessage[] = [
      {
        role: "user" as const,
        content: userContent,
      },
    ];
    let stepsUsedSoFar = 0;

    const stepApprovalId = opts?.execution?.stepApprovalId;
    if (stepApprovalId) {
      const approval = await this.approvalDal.getById(stepApprovalId);
      if (approval && approval.status !== "pending") {
        const resumeState = extractToolApprovalResumeState(approval.context);
        if (resumeState) {
          for (const toolId of resumeState.used_tools ?? []) {
            usedTools.add(toolId);
          }
          stepsUsedSoFar = resumeState.steps_used ?? countAssistantMessages(resumeState.messages);
          messages = appendToolApprovalResponseMessage(resumeState.messages, {
            approvalId: resumeState.approval_id,
            approved: approval.status === "approved",
            reason:
              approval.response_reason ??
              (approval.status === "expired"
                ? "approval expired"
                : approval.status === "cancelled"
                  ? "approval cancelled"
                  : undefined),
          });
        }
      }
    }

    const remainingSteps = this.maxSteps - stepsUsedSoFar;
    if (remainingSteps <= 0) {
      const reply = "No assistant response returned.";
      return await this.finalizeTurn(ctx, session, resolved, reply, usedTools, contextReport);
    }

    const withinTurnCfg = ctx.config.sessions.loop_detection.within_turn;
    const { stopWhen, withinTurnLoop } = this.createStopWhenWithWithinTurnLoopDetection({
      stepLimit: remainingSteps,
      withinTurnCfg,
      sessionId: session.session_id,
      channel: resolved.channel,
      threadId: resolved.thread_id,
    });

    const result = await generateText({
      model,
      system: systemPrompt,
      messages,
      tools: toolSet,
      stopWhen,
      prepareStep: ({ messages }) => this.prepareLaneQueueStep(laneQueue, messages),
      abortSignal: opts?.abortSignal,
      timeout: opts?.timeoutMs,
    });
    const stepsUsedAfterCall = stepsUsedSoFar + result.steps.length;

    const lastStep = result.steps.at(-1);
    const approvalPart = lastStep?.content.find((part) => {
      const record = coerceRecord(part);
      return record?.["type"] === "tool-approval-request";
    });

    if (approvalPart) {
      const record = coerceRecord(approvalPart);
      const approvalId =
        typeof record?.["approvalId"] === "string" ? record["approvalId"].trim() : "";
      const toolCall = coerceRecord(record?.["toolCall"]);

      const toolCallId =
        typeof toolCall?.["toolCallId"] === "string" ? toolCall["toolCallId"].trim() : "";
      const toolName =
        typeof toolCall?.["toolName"] === "string" ? toolCall["toolName"].trim() : "";
      const toolArgs = toolCall ? toolCall["input"] : undefined;

      if (!approvalId || !toolCallId || !toolName) {
        throw new Error("tool approval request missing required fields");
      }

      const state = toolCallPolicyStates.get(toolCallId);
      if (!state) {
        throw new Error(
          `tool approval request missing policy state for tool_call_id=${toolCallId}`,
        );
      }

      const responseMessages = (result.response?.messages ?? []) as unknown as ModelMessage[];
      const resumeMessages = [...messages, ...responseMessages];

      const expiresAt = new Date(Date.now() + this.approvalWaitMs).toISOString();

      const toolArgsHandle = await this.maybeStoreToolApprovalArgsHandle({
        toolId: state.toolDesc.id,
        toolCallId,
        args: state.args ?? toolArgs,
      });

      const policyContext = {
        policy_snapshot_id: state.policySnapshotId,
        agent_id: this.agentId,
        workspace_id: this.workspaceId,
        suggested_overrides: state.suggestedOverrides,
        applied_override_ids: state.appliedOverrideIds,
      };

      throw new ToolExecutionApprovalRequiredError({
        kind: "workflow_step",
        prompt: `Approve execution of '${state.toolDesc.id}' (risk=${state.toolDesc.risk})`,
        detail: `approval required for tool '${state.toolDesc.id}' (risk=${state.toolDesc.risk})`,
        expiresAt,
        context: {
          source: "agent-tool-execution",
          tool_id: state.toolDesc.id,
          tool_risk: state.toolDesc.risk,
          tool_call_id: toolCallId,
          tool_match_target: state.matchTarget,
          approval_step_index: state.approvalStepIndex ?? 0,
          args: state.args ?? toolArgs,
          session_id: session.session_id,
          channel: resolved.channel,
          thread_id: resolved.thread_id,
          policy: policyContext,
          ai_sdk: {
            approval_id: approvalId,
            messages: resumeMessages,
            used_tools: Array.from(usedTools),
            steps_used: stepsUsedAfterCall,
            tool_args_handle: toolArgsHandle,
          },
        },
      });
    }

    const rawReply = result.text || "";
    const reply = this.resolveTurnReply(rawReply, withinTurnLoop.value);
    return await this.finalizeTurn(ctx, session, resolved, reply, usedTools, contextReport);
  }

  private computeTurnsDroppedByNextAppend(
    turns: readonly SessionMessage[],
    maxTurns: number,
  ): SessionMessage[] {
    const maxMessages = Math.max(1, maxTurns) * 2;
    const overflow = turns.length + 2 - maxMessages;
    if (overflow <= 0) return [];
    return turns.slice(0, overflow);
  }

  private formatPreCompactionFlushPrompt(droppedTurns: readonly SessionMessage[]): string {
    const lines = droppedTurns.map((turn) => {
      const role = turn.role === "assistant" ? "Assistant" : "User";
      const redacted = redactSecretLikeText(turn.content.trim());
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
      return `${role} (${turn.timestamp}): ${content}`;
    });

    return [
      "This is a silent internal pre-compaction memory flush.",
      "The following messages are about to be compacted from the session context due to the session max_turns limit.",
      "Extract any durable, non-secret memory worth keeping (preferences, constraints, decisions, procedures).",
      "If there is nothing worth storing, respond with NOOP.",
      "",
      "Messages being compacted:",
      ...lines,
    ].join("\n");
  }

  private async maybeRunPreCompactionMemoryFlush(input: {
    ctx: AgentLoadedContext;
    session: SessionRow;
    model: LanguageModel;
    systemPrompt: string;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<void> {
    const v1Enabled = input.ctx.config.memory.v1.enabled;
    const markdownEnabled = input.ctx.config.memory.markdown_enabled;
    if (!v1Enabled && !markdownEnabled) {
      return;
    }

    const droppedTurns = this.computeTurnsDroppedByNextAppend(
      input.session.turns,
      input.ctx.config.sessions.max_turns,
    );
    if (droppedTurns.length === 0) {
      return;
    }

    const flushPromptText = this.formatPreCompactionFlushPrompt(droppedTurns);
    const flushKey = sha256HexFromString(`${input.session.session_id}\n${flushPromptText}`);
    const flushTag = `preflush:${flushKey}`;

    if (v1Enabled) {
      try {
        const memory = new MemoryV1Dal(this.opts.container.db);
        const existing = await memory.list({
          agentId: this.agentId,
          limit: 1,
          filter: { tags: [flushTag] },
        });
        if (existing.items.length > 0) {
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.opts.container.logger.warn("memory.flush_v1_dedupe_failed", {
          session_id: input.session.session_id,
          channel: input.session.channel,
          thread_id: input.session.thread_id,
          error: message,
        });
      }
    }

    const totalTimeoutMs = input.timeoutMs;
    const flushTimeoutMs = (() => {
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
    })();
    if (flushTimeoutMs <= 0) {
      return;
    }

    try {
      const flushResult = await generateText({
        model: input.model,
        system: input.systemPrompt,
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
        stopWhen: [stepCountIs(1)],
        abortSignal: input.abortSignal,
        timeout: flushTimeoutMs,
      });

      const rawFlushText = (flushResult.text ?? "").trim();
      if (rawFlushText.length === 0 || rawFlushText.toUpperCase() === "NOOP") {
        return;
      }

      const flushText = redactSecretLikeText(rawFlushText).trim();
      if (flushText.length === 0) {
        return;
      }

      if (flushText !== rawFlushText) {
        this.opts.container.logger.warn("memory.flush_redacted_secret_like", {
          session_id: input.session.session_id,
          channel: input.session.channel,
          thread_id: input.session.thread_id,
        });
      }

      const entry = ["Pre-compaction memory flush", "", flushText].join("\n").trim();

      if (v1Enabled) {
        try {
          const memory = new MemoryV1Dal(this.opts.container.db);
          await memory.create(
            {
              kind: "note",
              title: "Pre-compaction memory flush",
              body_md: flushText,
              tags: ["pre-compaction-flush", flushTag],
              sensitivity: "private",
              provenance: {
                source_kind: "system",
                channel: input.session.channel,
                thread_id: input.session.thread_id,
                session_id: input.session.session_id,
                refs: [],
                metadata: {
                  kind: "pre_compaction_memory_flush",
                  flush_key: flushKey,
                  dropped_messages: droppedTurns.length,
                },
              },
            },
            this.agentId,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.opts.container.logger.warn("memory.flush_v1_write_failed", {
            session_id: input.session.session_id,
            channel: input.session.channel,
            thread_id: input.session.thread_id,
            error: message,
          });
        }
      }

      if (markdownEnabled) {
        await input.ctx.memoryStore.appendDaily(entry);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.container.logger.warn("memory.flush_failed", {
        session_id: input.session.session_id,
        channel: input.session.channel,
        thread_id: input.session.thread_id,
        error: message,
      });
    }
  }

  private async turnViaExecutionEngine(input: AgentTurnRequestT): Promise<AgentTurnResponseT> {
    const deps = {
      agentId: this.agentId,
      workspaceId: this.workspaceId,
      executionEngine: this.executionEngine,
      executionWorkerId: this.executionWorkerId,
      turnEngineWaitMs: this.turnEngineWaitMs,
      approvalPollMs: this.approvalPollMs,
      db: this.opts.container.db,
      approvalDal: this.approvalDal,
      getWorkScope: () => this.getWorkScope(),
      resolveExecutionProfile: (args) => this.resolveExecutionProfile(args),
      turnDirect: (request, opts) => this.turnDirect(request, opts),
      resolveAgentTurnInput,
      resolveLaneQueueScope,
      resolveTurnRequestId,
      isToolExecutionApprovalRequiredError: (err: unknown): err is { pause: StepPauseRequest } =>
        err instanceof ToolExecutionApprovalRequiredError,
    } satisfies TurnEngineBridgeDeps;

    return await turnViaExecutionEngineBridge(deps, input);
  }

  private async semanticSearch(
    query: string,
    limit: number,
    primaryModelId: string,
    sessionId: string,
  ): Promise<MemoryV1SemanticSearchHit[]> {
    try {
      const pipeline = await this.resolveEmbeddingPipeline(primaryModelId, sessionId);
      if (!pipeline) return [];
      const index = new MemoryV1SemanticIndex({
        db: this.opts.container.db,
        agentId: this.agentId,
        embedder: {
          modelId: "runtime/embedding",
          embed: async (text: string) => pipeline.embed(text),
        },
      });
      return await index.search(query, limit);
    } catch {
      // Intentional: semantic search is best-effort; failures shouldn't block turns.
      return [];
    }
  }

  private async resolveEmbeddingPipeline(
    primaryModelId: string,
    sessionId: string,
  ): Promise<EmbeddingPipeline | undefined> {
    try {
      const loaded = await this.opts.container.modelsDev.ensureLoaded();
      const catalog = loaded.catalog;

      type ProviderEntry = (typeof catalog)[string];
      type ModelEntry = NonNullable<ProviderEntry["models"]>[string];
      type ResolvedEmbeddingCandidate = {
        providerId: string;
        modelId: string;
        provider: ProviderEntry;
        model: ModelEntry;
        npm: string;
        api: string | undefined;
      };

      const isEmbeddingModel = (id: string, model: ModelEntry): boolean => {
        if (/embedding/i.test(id)) return true;
        const family = (model as { family?: unknown }).family;
        if (typeof family === "string" && /embedding/i.test(family)) return true;
        const name = (model as { name?: unknown }).name;
        return typeof name === "string" && /embedding/i.test(name);
      };

      const resolveEmbeddingCandidate = (
        providerId: string,
      ): ResolvedEmbeddingCandidate | undefined => {
        const provider = catalog[providerId];
        if (!provider) return undefined;

        const models = provider.models ?? {};
        const preferredIds = ["text-embedding-3-small", "text-embedding-3-large"];
        let embeddingModelId: string | undefined;
        for (const id of preferredIds) {
          if (Object.hasOwn(models, id)) {
            embeddingModelId = id;
            break;
          }
        }
        if (!embeddingModelId) {
          const candidateIds = Object.entries(models)
            .filter(([id, model]) => isEmbeddingModel(id, model))
            .map(([id]) => id)
            .sort((a, b) => a.localeCompare(b));
          embeddingModelId = candidateIds[0];
        }

        if (!embeddingModelId) return undefined;
        const model = models[embeddingModelId];
        if (!model) return undefined;

        const providerOverride = (model as { provider?: { npm?: string; api?: string } }).provider;
        const npm = providerOverride?.npm ?? provider.npm;
        const api = providerOverride?.api ?? provider.api;
        if (!npm) return undefined;

        return {
          providerId,
          modelId: embeddingModelId,
          provider,
          model,
          npm,
          api,
        };
      };

      const primaryProviderId = (() => {
        try {
          return parseProviderModelId(primaryModelId).providerId;
        } catch {
          // Intentional: model_id may be malformed; fall back to non-primary providers.
          return undefined;
        }
      })();

      const orderedProviderIds: string[] = [];
      const seen = new Set<string>();
      const addProvider = (id: string | undefined): void => {
        const trimmed = id?.trim();
        if (!trimmed) return;
        if (!catalog[trimmed]) return;
        if (seen.has(trimmed)) return;
        seen.add(trimmed);
        orderedProviderIds.push(trimmed);
      };

      addProvider(primaryProviderId);
      addProvider("openai");
      for (const id of Object.keys(catalog).sort((a, b) => a.localeCompare(b))) {
        addProvider(id);
      }

      const {
        secretProvider,
        resolver,
        authProfileDal,
        pinDal,
        oauthProviderRegistry,
        oauthRefreshLeaseDal,
        logger,
        oauthLeaseOwner,
        fetchImpl,
      } = buildProviderResolutionSetup({
        container: this.opts.container,
        secretProvider: this.opts.secretProvider,
        oauthLeaseOwner: this.instanceOwner,
        fetchImpl: this.fetchImpl,
      });

      const resolveProviderApiKey = async (
        providerId: string,
        provider: ProviderEntry,
      ): Promise<string | undefined> => {
        const orderedProfiles = await listOrderedEligibleProfilesForProvider({
          agentId: this.agentId,
          sessionId,
          providerId,
          resolver,
          authProfileDal,
          pinDal,
        });

        for (const profile of orderedProfiles) {
          const apiKey = await resolveProfileApiKey(profile, {
            secretProvider,
            resolver,
            authProfileDal,
            oauthProviderRegistry,
            oauthRefreshLeaseDal,
            oauthLeaseOwner,
            logger,
            fetchImpl,
          });
          if (apiKey) return apiKey;
        }

        return resolveEnvApiKey(provider.env);
      };

      for (const providerId of orderedProviderIds) {
        const candidate = resolveEmbeddingCandidate(providerId);
        if (!candidate) continue;

        const apiKey = await resolveProviderApiKey(candidate.providerId, candidate.provider);
        if (!apiKey) {
          const hasApiKeyHint = (candidate.provider.env ?? []).some((key) =>
            /(_API_KEY|_TOKEN)$/i.test(key),
          );
          if (hasApiKeyHint) continue;
        }

        const baseURL = resolveProviderBaseURL({
          providerEnv: candidate.provider.env,
          providerApi: candidate.api,
        });

        const sdk = createProviderFromNpm({
          npm: candidate.npm,
          providerId: candidate.providerId,
          apiKey,
          baseURL,
          fetchImpl: this.fetchImpl,
        });

        const sdkAny = sdk as any;
        const embeddingModel =
          typeof sdkAny.textEmbeddingModel === "function"
            ? sdkAny.textEmbeddingModel(candidate.modelId)
            : typeof sdkAny.embeddingModel === "function"
              ? sdkAny.embeddingModel(candidate.modelId)
              : undefined;
        if (!embeddingModel) continue;

        const vectorDal = new VectorDal(this.opts.container.db);
        return new EmbeddingPipeline({
          vectorDal,
          agentId: this.agentId,
          embeddingModel,
          embeddingModelId: `${candidate.providerId}/${candidate.modelId}`,
        });
      }

      return undefined;
    } catch {
      // Intentional: embedding pipeline is optional; semantic search should degrade gracefully.
      return undefined;
    }
  }

  private async prepareTurn(
    input: AgentTurnRequestT,
    exec?: TurnExecutionContext,
  ): Promise<{
    ctx: AgentLoadedContext;
    executionProfile: ResolvedExecutionProfile;
    session: SessionRow;
    mainLaneSessionKey: string;
    model: LanguageModel;
    toolSet: ToolSet;
    toolCallPolicyStates: Map<string, ToolCallPolicyState>;
    laneQueue?: LaneQueueState;
    usedTools: Set<string>;
    userContent: Array<{ type: "text"; text: string }>;
    contextReport: AgentContextReport;
    systemPrompt: string;
    resolved: ResolvedAgentTurnInput;
  }> {
    const ctx = await this.loadContext();
    this.maybeCleanupSessions(ctx.config.sessions.ttl_days);

    const resolved = resolveAgentTurnInput(input);
    const laneQueueScope = resolveLaneQueueScope(resolved.metadata);
    const laneQueue: LaneQueueState | undefined = laneQueueScope
      ? {
          scope: laneQueueScope,
          signals: new LaneQueueSignalDal(this.opts.container.db),
          interruptError: undefined,
          cancelToolCalls: false,
          pendingInjectionTexts: [],
        }
      : undefined;
    const session = await this.sessionDal.getOrCreate(
      resolved.channel,
      resolved.thread_id,
      this.agentId,
    );
    const agentId = this.agentId;
    const workspaceId = this.workspaceId;

    const containerKind: NormalizedContainerKind =
      input.container_kind ?? resolved.envelope?.container.kind ?? "channel";
    const mainLaneSessionKey = resolveMainLaneSessionKey({
      agentId,
      workspaceId,
      resolved,
      containerKind,
      deliveryAccount: resolved.envelope?.delivery.account,
    });

    const executionProfile = await this.resolveExecutionProfile({
      laneQueueScope,
      metadata: resolved.metadata,
    });

    const wantsMcpTools = ctx.config.tools.allow.some(
      (entry) => entry === "*" || entry === "mcp*" || entry.startsWith("mcp."),
    );

    const memoryDigestPromise =
      isStatusQuery(resolved.message) || parseIntakeModeDecision(resolved.message)
        ? Promise.resolve({
            digest: "Skipped for command turns.",
            included_item_ids: [],
            keyword_hit_count: 0,
            semantic_hit_count: 0,
            structured_item_count: 0,
          })
        : (async () => {
            try {
              return await buildMemoryV1Digest({
                dal: new MemoryV1Dal(this.opts.container.db),
                agentId,
                query: resolved.message,
                config: ctx.config.memory.v1,
                semanticSearch: ctx.config.memory.v1.semantic.enabled
                  ? (query, limit) =>
                      this.semanticSearch(query, limit, ctx.config.model.model, session.session_id)
                  : undefined,
              });
            } catch (error) {
              this.opts.container.logger.warn("memory.v1.digest_failed", {
                session_id: session.session_id,
                agent_id: agentId,
                error: error instanceof Error ? error.message : String(error),
              });
              return {
                digest: "Memory digest unavailable.",
                included_item_ids: [],
                keyword_hit_count: 0,
                semantic_hit_count: 0,
                structured_item_count: 0,
              };
            }
          })();

    const [memoryDigestResult, mcpTools] = await Promise.all([
      memoryDigestPromise,
      wantsMcpTools
        ? this.mcpManager.listToolDescriptors(ctx.mcpServers)
        : this.mcpManager.listToolDescriptors([]),
    ]);

    const pluginToolsRaw = this.plugins?.getToolDescriptors() ?? [];
    const { allowlist: toolAllowlist, pluginTools } =
      await this.resolvePolicyGatedPluginToolExposure({
        allowlist: ctx.config.tools.allow,
        pluginTools: pluginToolsRaw,
      });
    const toolCandidates = selectToolDirectory(
      resolved.message,
      toolAllowlist,
      [...mcpTools, ...pluginTools],
      Number.POSITIVE_INFINITY,
    );
    const filteredTools = toolCandidates
      .filter((tool) => isToolAllowed(executionProfile.profile.tool_allowlist, tool.id))
      .slice(0, 8);

    // Build MCP server spec lookup for ToolExecutor
    const mcpSpecMap = new Map<string, McpServerSpecT>();
    for (const server of ctx.mcpServers) {
      mcpSpecMap.set(server.id, server);
    }

    const nodeDispatchService = this.opts.protocolDeps
      ? new NodeDispatchService(this.opts.protocolDeps)
      : undefined;

    const toolExecutor = new ToolExecutor(
      this.home,
      this.mcpManager,
      mcpSpecMap,
      this.fetchImpl,
      this.opts.secretProvider,
      undefined,
      this.opts.container.redactionEngine,
      this.opts.container.secretResolutionAuditDal,
      {
        db: this.opts.container.db,
        workspaceId,
        ownerPrefix: this.instanceOwner,
      },
      nodeDispatchService,
      this.opts.container.artifactStore,
    );

    const sessionCtx = formatSessionContext(session.summary, session.turns);
    const workFocusDigest =
      isStatusQuery(resolved.message) || parseIntakeModeDecision(resolved.message)
        ? "Skipped for command turns."
        : await this.buildWorkFocusDigest();

    const identityPrompt = formatIdentityPrompt(ctx.identity);
    const safetyPrompt = DATA_TAG_SAFETY_PROMPT;

    const hardeningProfile = resolveSandboxHardeningProfile();
    const elevatedExecutionAvailable = await deriveElevatedExecutionAvailable(this.policyService);
    const sandboxPrompt = [
      "Sandbox:",
      `Hardening profile: ${hardeningProfile}`,
      `Elevated execution available: ${
        elevatedExecutionAvailable === null ? "unknown" : String(elevatedExecutionAvailable)
      }`,
    ].join("\n");

    const systemPrompt = `${identityPrompt}\n\n${safetyPrompt}\n\n${sandboxPrompt}`;
    const skillsText = `Enabled skills:\n${formatSkillsPrompt(ctx.skills)}`;
    const toolsText = `Available tools:\n${formatToolPrompt(filteredTools)}`;
    const sessionText = `Session context:\n${sessionCtx}`;
    const workFocusText = `Work focus digest:\n${workFocusDigest}`;
    const memoryTagged = tagContent(memoryDigestResult.digest, "memory", false);
    const memoryText = `Memory digest:\n${sanitizeForModel(memoryTagged)}`;

    const toolSchemaParts = filteredTools.map((t) => {
      const schema = t.inputSchema ?? { type: "object", additionalProperties: true };
      let chars = 0;
      try {
        chars = JSON.stringify(schema).length;
      } catch {
        // Intentional: schema may contain cycles/BigInt; treat size as unknown.
        chars = 0;
      }
      return { id: t.id, chars };
    });
    const toolSchemaTotalChars = toolSchemaParts.reduce((total, part) => total + part.chars, 0);
    const toolSchemaTop = toolSchemaParts
      .slice()
      .sort((a, b) => b.chars - a.chars)
      .slice(0, 5);

    const contextReportId = randomUUID();
    const report: AgentContextReport = {
      context_report_id: contextReportId,
      generated_at: new Date().toISOString(),
      session_id: session.session_id,
      channel: resolved.channel,
      thread_id: resolved.thread_id,
      agent_id: agentId,
      workspace_id: workspaceId,
      system_prompt: {
        chars: systemPrompt.length,
        sections: [
          { id: "identity", chars: identityPrompt.length },
          { id: "safety", chars: safetyPrompt.length },
          { id: "sandbox", chars: sandboxPrompt.length },
        ],
      },
      user_parts: [
        { id: "skills", chars: skillsText.length },
        { id: "tools", chars: toolsText.length },
        { id: "session_context", chars: sessionText.length },
        { id: "work_focus_digest", chars: workFocusText.length },
        { id: "memory_digest", chars: memoryText.length },
        { id: "message", chars: resolved.message.length },
      ],
      selected_tools: filteredTools.map((t) => t.id),
      execution_profile: executionProfile.id,
      execution_profile_source: executionProfile.source,
      tool_schema_top: toolSchemaTop,
      tool_schema_total_chars: toolSchemaTotalChars,
      enabled_skills: ctx.skills.map((s) => s.meta.id),
      mcp_servers: ctx.mcpServers.map((s) => s.id),
      memory: {
        keyword_hits: memoryDigestResult.keyword_hit_count,
        semantic_hits: memoryDigestResult.semantic_hit_count,
        structured_hits: memoryDigestResult.structured_item_count,
        included_items: memoryDigestResult.included_item_ids.length,
      },
      tool_calls: [],
      injected_files: [],
    };
    const validated = ContextReportSchema.safeParse(report);
    const validatedReport = (() => {
      if (validated.success) {
        return validated.data as unknown as AgentContextReport;
      }
      this.opts.container.logger.warn("context_report.invalid", {
        context_report_id: contextReportId,
        session_id: session.session_id,
        error: validated.error.message,
      });
      return report;
    })();
    const usedTools = new Set<string>();
    const toolCallPolicyStates = new Map<string, ToolCallPolicyState>();
    const toolSet = this.buildToolSet(
      filteredTools,
      toolExecutor,
      usedTools,
      {
        planId: exec?.planId ?? `agent-turn-${session.session_id}-${randomUUID()}`,
        sessionId: session.session_id,
        channel: resolved.channel,
        threadId: resolved.thread_id,
        execution: exec
          ? {
              runId: exec.runId,
              stepIndex: exec.stepIndex,
              stepId: exec.stepId,
              stepApprovalId: exec.stepApprovalId,
            }
          : undefined,
      },
      validatedReport,
      laneQueue,
      toolCallPolicyStates,
    );

    const userContent: Array<{ type: "text"; text: string }> = [
      {
        type: "text",
        text: skillsText,
      },
      {
        type: "text",
        text: toolsText,
      },
      {
        type: "text",
        text: sessionText,
      },
      {
        type: "text",
        text: workFocusText,
      },
      {
        type: "text",
        text: memoryText,
      },
      {
        type: "text",
        text: resolved.message,
      },
    ];

    const model = await this.resolveSessionModel({
      config: ctx.config,
      sessionId: session.session_id,
      profileModelId: executionProfile.profile.model_id,
      fetchImpl: this.fetchImpl,
    });

    return {
      ctx,
      executionProfile,
      session,
      mainLaneSessionKey,
      model,
      toolSet,
      toolCallPolicyStates,
      laneQueue,
      usedTools,
      userContent,
      contextReport: validatedReport,
      systemPrompt,
      resolved,
    };
  }

  private async resolveExecutionProfile(input: {
    laneQueueScope?: LaneQueueScope;
    metadata?: Record<string, unknown>;
  }): Promise<ResolvedExecutionProfile> {
    const laneQueueScope = input.laneQueueScope;
    const isSubagentTurn =
      laneQueueScope &&
      laneQueueScope.lane === "subagent" &&
      laneQueueScope.key.startsWith(`agent:${this.agentId}:subagent:`) &&
      SubagentSessionKey.safeParse(laneQueueScope.key).success;

    if (!isSubagentTurn) {
      const id: ExecutionProfileId = "interaction";
      return { id, profile: getExecutionProfile(id), source: "interaction_default" };
    }

    const subagentId = (() => {
      const fromMeta = input.metadata?.["subagent_id"];
      if (typeof fromMeta === "string" && fromMeta.trim().length > 0) {
        return fromMeta.trim();
      }

      const parts = laneQueueScope.key.split(":");
      const last = parts.at(-1)?.trim();
      return last && last.length > 0 ? last : undefined;
    })();

    if (!subagentId) {
      const id: ExecutionProfileId = "explorer_ro";
      return { id, profile: getExecutionProfile(id), source: "subagent_fallback" };
    }

    try {
      const workboard = new WorkboardDal(this.opts.container.db);
      const scope = {
        tenant_id: "default",
        agent_id: this.agentId,
        workspace_id: this.workspaceId,
      } as const;
      const subagent = await workboard.getSubagent({ scope, subagent_id: subagentId });
      const normalized =
        subagent && typeof subagent.execution_profile === "string"
          ? normalizeExecutionProfileId(subagent.execution_profile)
          : undefined;
      if (!subagent || !normalized) {
        const id: ExecutionProfileId = "explorer_ro";
        return { id, profile: getExecutionProfile(id), source: "subagent_fallback" };
      }

      const id: ExecutionProfileId = normalized;
      const profile = getExecutionProfile(normalized);
      if (!profile.allowed_lanes.includes("subagent")) {
        const fallbackId: ExecutionProfileId = "explorer_ro";
        return {
          id: fallbackId,
          profile: getExecutionProfile(fallbackId),
          source: "subagent_fallback",
        };
      }

      return {
        id,
        profile,
        source: "subagent_record",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.container.logger.warn("workboard.subagent_profile_resolve_failed", {
        subagent_id: subagentId,
        error: message,
      });
      const id: ExecutionProfileId = "explorer_ro";
      return { id, profile: getExecutionProfile(id), source: "subagent_fallback" };
    }
  }

  private async resolveIntakeDecision(input: {
    input: AgentTurnRequestT;
    executionProfile: ResolvedExecutionProfile;
    resolved: ResolvedAgentTurnInput;
    mainLaneSessionKey: string;
  }): Promise<{
    mode: "inline" | "delegate_execute" | "delegate_plan";
    reason_code: string;
  }> {
    if (input.executionProfile.id !== "interaction") {
      return { mode: "inline", reason_code: "non_interaction" };
    }

    const requested = input.input.intake_mode;
    if (requested === "inline") {
      return { mode: "inline", reason_code: "request_field" };
    }
    if (requested === "delegate_execute" || requested === "delegate_plan") {
      return { mode: requested, reason_code: "request_field" };
    }

    const key = input.mainLaneSessionKey;

    try {
      const dal = new IntakeModeOverrideDal(this.opts.container.db);
      const row = await dal.get({ key, lane: "main" });
      const override = row?.intake_mode?.trim()?.toLowerCase() ?? "";
      if (override === "inline") {
        return { mode: "inline", reason_code: "override" };
      }
      if (override === "delegate_execute" || override === "delegate_plan") {
        return { mode: override, reason_code: "override" };
      }
    } catch {
      // Intentional: ignore override lookup failures; fall back to default inline.
    }

    return { mode: "inline", reason_code: "default_inline" };
  }

  private async delegateFromIntake(input: {
    executionProfile: ResolvedExecutionProfile;
    mode: "delegate_execute" | "delegate_plan";
    reason_code: string;
    resolved: ResolvedAgentTurnInput;
    createdFromSessionKey: string;
  }): Promise<{ reply: string; work_item_id: string; subagent_id?: string }> {
    const required = ["subagent.spawn", "work.write"] as const;
    for (const cap of required) {
      if (!input.executionProfile.profile.capabilities.includes(cap)) {
        return {
          reply: `Delegation denied: execution profile '${input.executionProfile.id}' lacks capability '${cap}'.`,
          work_item_id: "",
        };
      }
    }

    const scope = {
      tenant_id: "default",
      agent_id: this.agentId,
      workspace_id: this.workspaceId,
    } as const;

    const workboard = new WorkboardDal(this.opts.container.db);

    const delegatedProfileId: ExecutionProfileId =
      input.mode === "delegate_plan" ? "planner" : "executor_rw";
    const delegatedProfile = getExecutionProfile(delegatedProfileId);

    const title = (() => {
      const firstLine = input.resolved.message.split("\n")[0]?.trim() ?? "";
      const normalized = firstLine.length > 0 ? firstLine : "Delegated work";
      return normalized.slice(0, 140);
    })();

    const workItem = await workboard.createItem({
      scope,
      item: {
        kind: input.mode === "delegate_plan" ? "initiative" : "action",
        title,
        budgets: delegatedProfile.budgets,
      },
      createdFromSessionKey: input.createdFromSessionKey,
    });

    await workboard.appendEvent({
      scope,
      work_item_id: workItem.work_item_id,
      kind: "intake.mode_selected",
      payload_json: {
        mode: input.mode,
        reason_code: input.reason_code,
        delegated_execution_profile: delegatedProfileId,
      },
    });

    const quota = input.executionProfile.profile.quotas?.max_running_subagents;
    if (quota !== undefined) {
      const { subagents } = await workboard.listSubagents({
        scope,
        statuses: ["running"],
        limit: 200,
      });
      if (subagents.length >= quota) {
        return {
          reply:
            `Delegated to WorkItem ${workItem.work_item_id} (mode=${input.mode}). ` +
            `Spawn quota reached (${String(subagents.length)}/${String(quota)}); no subagent spawned.`,
          work_item_id: workItem.work_item_id,
        };
      }
    }

    const subagentId = randomUUID();
    const sessionKey = `agent:${this.agentId}:subagent:${subagentId}`;
    const subagent = await workboard.createSubagent({
      scope,
      subagent: {
        execution_profile: delegatedProfileId,
        session_key: sessionKey,
        lane: "subagent",
        status: "running",
        work_item_id: workItem.work_item_id,
      },
      subagentId,
    });

    return {
      reply:
        `Delegated to WorkItem ${workItem.work_item_id} (mode=${input.mode}, reason=${input.reason_code}). ` +
        `Spawned subagent ${subagent.subagent_id} (profile=${subagent.execution_profile}).`,
      work_item_id: workItem.work_item_id,
      subagent_id: subagent.subagent_id,
    };
  }

  private async finalizeTurn(
    ctx: AgentLoadedContext,
    session: SessionRow,
    input: ResolvedAgentTurnInput,
    reply: string,
    usedTools: Set<string>,
    contextReport: AgentContextReport,
  ): Promise<AgentTurnResponseT> {
    const nowIso = new Date().toISOString();

    let finalizedReply = reply;
    const crossTurnCfg = ctx.config.sessions.loop_detection.cross_turn;
    if (crossTurnCfg.enabled && !finalizedReply.includes(LOOP_WARNING_PREFIX)) {
      const previousAssistantMessages = session.turns
        .filter((turn) => turn.role === "assistant")
        .map((turn) => turn.content);

      const decision = decideCrossTurnLoopWarning({
        previousAssistantMessages,
        reply: finalizedReply,
        windowAssistantMessages: crossTurnCfg.window_assistant_messages,
        similarityThreshold: crossTurnCfg.similarity_threshold,
        minChars: crossTurnCfg.min_chars,
        cooldownAssistantMessages: crossTurnCfg.cooldown_assistant_messages,
      });
      if (decision.warn) {
        finalizedReply = `${finalizedReply.trimEnd()}\n\n${CROSS_TURN_LOOP_WARNING_TEXT}`;
        this.opts.container.logger.info("agents.loop.cross_turn_warned", {
          session_id: session.session_id,
          channel: input.channel,
          thread_id: input.thread_id,
          similarity: decision.similarity,
          matched_index: decision.matchedIndex,
        });
      }
    }

    this.lastContextReport = contextReport;
    try {
      await this.opts.container.contextReportDal.insert({
        contextReportId: contextReport.context_report_id,
        sessionId: session.session_id,
        channel: input.channel,
        threadId: input.thread_id,
        agentId: contextReport.agent_id,
        workspaceId: contextReport.workspace_id,
        report: contextReport,
        createdAtIso: contextReport.generated_at,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.container.logger.warn("context_report.persist_failed", {
        context_report_id: contextReport.context_report_id,
        session_id: session.session_id,
        error: message,
      });
    }

    await this.sessionDal.appendTurn(
      session.session_id,
      input.message,
      finalizedReply,
      ctx.config.sessions.max_turns,
      nowIso,
      this.agentId,
    );

    let memoryWritten = false;
    if (ctx.config.memory.markdown_enabled) {
      const entry = [
        `Channel: ${input.channel}`,
        `Thread: ${input.thread_id}`,
        `User: ${input.message}`,
        `Assistant: ${finalizedReply}`,
      ].join("\n");
      if (looksLikeSecretText(entry)) {
        this.opts.container.logger.warn("memory.write_skipped_secret_like", {
          session_id: session.session_id,
          channel: input.channel,
          thread_id: input.thread_id,
        });
      } else {
        await ctx.memoryStore.appendDaily(entry);
        memoryWritten = true;

        if (shouldPromoteToCoreMemory(input.message)) {
          await ctx.memoryStore.appendToCoreSection(
            "Learned Preferences",
            `- ${input.message.trim()}`,
          );
        }
      }
    }

    try {
      await recordMemoryV1SystemEpisode(
        this.opts.container.memoryV1Dal,
        {
          occurred_at: nowIso,
          channel: input.channel,
          event_type: "agent_turn",
          summary_md: `Agent turn: ${input.channel}`,
          tags: ["agent", "turn"],
          metadata: {
            channel: input.channel,
            thread_id: input.thread_id,
            session_id: session.session_id,
          },
        },
        this.agentId,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.container.logger.warn("memory.v1.system_episode_record_failed", {
        session_id: session.session_id,
        channel: input.channel,
        thread_id: input.thread_id,
        error: message,
      });
    }

    return AgentTurnResponse.parse({
      reply: finalizedReply,
      session_id: session.session_id,
      used_tools: Array.from(usedTools),
      memory_written: memoryWritten,
    });
  }

  private buildToolSet(
    tools: readonly ToolDescriptor[],
    toolExecutor: ToolExecutor,
    usedTools: Set<string>,
    toolExecutionContext: ToolExecutionContext,
    contextReport: AgentContextReport,
    laneQueue?: LaneQueueState,
    toolCallPolicyStates?: Map<string, ToolCallPolicyState>,
  ): ToolSet {
    const result: Record<string, Tool> = {};
    let approvalStepIndex = 0;
    let drivingProvenance: { source: string; trusted: boolean } = {
      source: "user",
      trusted: true,
    };

    const resolveToolCallPolicyState = async (input: {
      toolDesc: ToolDescriptor;
      toolCallId: string;
      args: unknown;
      inputProvenance: { source: string; trusted: boolean };
    }): Promise<ToolCallPolicyState> => {
      const existing = toolCallPolicyStates?.get(input.toolCallId);
      if (existing && existing.toolDesc.id === input.toolDesc.id) {
        return existing;
      }

      const matchTarget = canonicalizeToolMatchTarget(input.toolDesc.id, input.args, this.home);

      const policy = this.policyService;
      const policyEnabled = policy.isEnabled();

      let policyDecision: Decision | undefined;
      let policySnapshotId: string | undefined;
      let appliedOverrideIds: string[] | undefined;

      if (policyEnabled) {
        const agentId = this.agentId;
        const workspaceId = this.workspaceId;

        const url =
          input.toolDesc.id === "tool.http.fetch" &&
          input.args &&
          typeof (input.args as Record<string, unknown>)["url"] === "string"
            ? String((input.args as Record<string, unknown>)["url"])
            : undefined;

        const handleIds = collectSecretHandleIds(input.args);
        const secretScopes: string[] = [];
        if (handleIds.length > 0 && this.opts.secretProvider) {
          const handles = await this.opts.secretProvider.list();
          for (const id of handleIds) {
            const handle = handles.find((h) => h.handle_id === id);
            if (handle?.scope) {
              secretScopes.push(`${handle.provider}:${handle.scope}`);
            } else {
              secretScopes.push(id);
            }
          }
        }

        const evaluation = await policy.evaluateToolCall({
          agentId,
          workspaceId,
          toolId: input.toolDesc.id,
          toolMatchTarget: matchTarget,
          url,
          secretScopes: secretScopes.length > 0 ? secretScopes : undefined,
          inputProvenance: input.inputProvenance,
        });
        policyDecision = evaluation.decision;
        policySnapshotId = evaluation.policy_snapshot?.policy_snapshot_id;
        appliedOverrideIds = evaluation.applied_override_ids;
      }

      const shouldRequireApproval =
        policyEnabled && !policy.isObserveOnly()
          ? policyDecision === "require_approval"
          : input.toolDesc.requires_confirmation;

      const suggestedOverrides = policyEnabled
        ? suggestedOverridesForToolCall({
            toolId: input.toolDesc.id,
            matchTarget,
            workspaceId: this.workspaceId,
          })
        : undefined;

      const state: ToolCallPolicyState = {
        toolDesc: input.toolDesc,
        toolCallId: input.toolCallId,
        args: input.args,
        matchTarget,
        inputProvenance: input.inputProvenance,
        policyDecision,
        policySnapshotId,
        appliedOverrideIds,
        suggestedOverrides,
        approvalStepIndex: existing?.approvalStepIndex,
        shouldRequireApproval,
      };

      toolCallPolicyStates?.set(input.toolCallId, state);
      return state;
    };

    const resolveResumedToolArgs = async (input: {
      toolId: string;
      toolCallId: string;
      args: unknown;
    }): Promise<unknown> => {
      const execution = toolExecutionContext.execution;
      if (!execution?.stepApprovalId) return input.args;

      const secretProvider = this.opts.secretProvider;
      if (!secretProvider || secretProvider instanceof EnvSecretProvider) {
        return input.args;
      }

      const approval = await this.approvalDal.getById(execution.stepApprovalId);
      const ctx = coerceRecord(approval?.context);
      if (!ctx || ctx["source"] !== "agent-tool-execution") return input.args;
      if (ctx["tool_id"] !== input.toolId || ctx["tool_call_id"] !== input.toolCallId) {
        return input.args;
      }

      const aiSdk = coerceRecord(ctx["ai_sdk"]);
      const handle = coerceSecretHandle(aiSdk?.["tool_args_handle"]);
      if (!handle) return input.args;

      const raw = await secretProvider.resolve(handle);
      if (!raw) return input.args;

      try {
        return JSON.parse(raw) as unknown;
      } catch {
        // Intentional: handle may reference stale/malformed JSON; treat as unchanged args.
        return input.args;
      }
    };

    for (const toolDesc of tools) {
      const schema = toolDesc.inputSchema ?? { type: "object", additionalProperties: true };

      result[toolDesc.id] = aiTool({
        description: toolDesc.description,
        inputSchema: jsonSchema(schema),
        needsApproval: toolExecutionContext.execution
          ? async (
              args: unknown,
              options: {
                toolCallId: string;
                messages: ModelMessage[];
                experimental_context?: unknown;
              },
            ): Promise<boolean> => {
              if (laneQueue) {
                if (laneQueue.cancelToolCalls || laneQueue.interruptError) {
                  return false;
                }

                const signal = await laneQueue.signals.claimSignal(laneQueue.scope);
                if (signal?.kind === "interrupt") {
                  laneQueue.interruptError ??= new LaneQueueInterruptError();
                  laneQueue.cancelToolCalls = true;
                  return false;
                }
                if (signal?.kind === "steer") {
                  const text = signal.message_text.trim();
                  if (text.length > 0) {
                    laneQueue.pendingInjectionTexts.push(text);
                  }
                  laneQueue.cancelToolCalls = true;
                  return false;
                }
              }

              const effectiveArgs = await resolveResumedToolArgs({
                toolId: toolDesc.id,
                toolCallId: options.toolCallId,
                args,
              });

              const state = await resolveToolCallPolicyState({
                toolDesc,
                toolCallId: options.toolCallId,
                args: effectiveArgs,
                inputProvenance: { ...drivingProvenance },
              });

              if (!state.shouldRequireApproval) {
                return false;
              }

              const stepApprovalId = toolExecutionContext.execution?.stepApprovalId;
              if (stepApprovalId) {
                const approval = await this.approvalDal.getById(stepApprovalId);
                if (
                  approval &&
                  (approval.status === "approved" ||
                    approval.status === "denied" ||
                    approval.status === "expired")
                ) {
                  const ctx = coerceRecord(approval.context);
                  const matches =
                    ctx?.["source"] === "agent-tool-execution" &&
                    ctx["tool_id"] === toolDesc.id &&
                    ctx["tool_call_id"] === options.toolCallId &&
                    ctx["tool_match_target"] === state.matchTarget;
                  if (matches && !hasToolResult(options.messages, options.toolCallId)) {
                    return false;
                  }
                }
              }

              if (state.approvalStepIndex === undefined) {
                state.approvalStepIndex = approvalStepIndex++;
                toolCallPolicyStates?.set(options.toolCallId, state);
              }

              return true;
            }
          : undefined,
        execute: async (args: unknown, options: ToolExecutionOptions) => {
          if (laneQueue) {
            const signal = await laneQueue.signals.claimSignal(laneQueue.scope);
            if (signal?.kind === "interrupt") {
              laneQueue.interruptError ??= new LaneQueueInterruptError();
              laneQueue.cancelToolCalls = true;
            }
            if (signal?.kind === "steer") {
              const text = signal.message_text.trim();
              if (text.length > 0) {
                laneQueue.pendingInjectionTexts.push(text);
              }
              laneQueue.cancelToolCalls = true;
            }

            if (laneQueue.cancelToolCalls) {
              return JSON.stringify({
                error: "cancelled",
                reason: laneQueue.interruptError ? "interrupt" : "steer",
              });
            }
          }

          const toolCallId =
            typeof options?.toolCallId === "string" && options.toolCallId.trim().length > 0
              ? options.toolCallId.trim()
              : `tc-${randomUUID()}`;

          const effectiveArgs = await resolveResumedToolArgs({
            toolId: toolDesc.id,
            toolCallId,
            args,
          });

          const state = await resolveToolCallPolicyState({
            toolDesc,
            toolCallId,
            args: effectiveArgs,
            inputProvenance: { ...drivingProvenance },
          });

          const policy = this.policyService;
          const policyEnabled = policy.isEnabled();
          const policySnapshotId = state.policySnapshotId;

          if (policyEnabled && state.policyDecision === "deny" && !policy.isObserveOnly()) {
            return JSON.stringify({
              error: `policy denied tool execution for '${toolDesc.id}'`,
              decision: "deny",
            });
          }

          if (state.shouldRequireApproval) {
            const policyContext = {
              policy_snapshot_id: policySnapshotId,
              agent_id: this.agentId,
              workspace_id: this.workspaceId,
              suggested_overrides: state.suggestedOverrides,
              applied_override_ids: state.appliedOverrideIds,
            };

            const approvalStepIndexValue =
              state.approvalStepIndex === undefined
                ? (() => {
                    const next = approvalStepIndex++;
                    state.approvalStepIndex = next;
                    toolCallPolicyStates?.set(toolCallId, state);
                    return next;
                  })()
                : state.approvalStepIndex;

            if (toolExecutionContext.execution) {
              const stepApprovalId = toolExecutionContext.execution.stepApprovalId;
              if (!stepApprovalId) {
                return JSON.stringify({
                  error: `tool execution not approved for '${toolDesc.id}'`,
                  status: "pending",
                });
              }

              const approval = await this.approvalDal.getById(stepApprovalId);
              const approved = approval?.status === "approved";
              const ctx = coerceRecord(approval?.context);
              const matches =
                ctx?.["source"] === "agent-tool-execution" &&
                ctx["tool_id"] === toolDesc.id &&
                ctx["tool_call_id"] === toolCallId &&
                ctx["tool_match_target"] === state.matchTarget;

              if (!approved || !matches) {
                return JSON.stringify({
                  error: `tool execution not approved for '${toolDesc.id}'`,
                  approval_id: stepApprovalId,
                  status: approval?.status ?? "pending",
                  reason: approval?.response_reason ?? undefined,
                });
              }
            } else {
              const decision = await this.awaitApprovalForToolExecution(
                toolDesc,
                effectiveArgs,
                toolCallId,
                toolExecutionContext,
                approvalStepIndexValue,
                policyContext,
              );
              if (!decision.approved) {
                return JSON.stringify({
                  error: `tool execution not approved for '${toolDesc.id}'`,
                  approval_id: decision.approvalId,
                  status: decision.status,
                  reason: decision.reason,
                });
              }
            }
          }

          usedTools.add(toolDesc.id);
          const agentId = this.agentId;
          const workspaceId = this.workspaceId;

          const pluginRes = await this.plugins?.executeTool({
            toolId: toolDesc.id,
            toolCallId,
            args: effectiveArgs,
            home: this.home,
            agentId,
            workspaceId,
            auditPlanId: toolExecutionContext.planId,
            sessionId: toolExecutionContext.sessionId,
            channel: toolExecutionContext.channel,
            threadId: toolExecutionContext.threadId,
            policySnapshotId,
          });

          const res: ToolResult = pluginRes
            ? (() => {
                const tagged = tagContent(pluginRes.output, "tool", false);
                return {
                  tool_call_id: toolCallId,
                  output: sanitizeForModel(tagged),
                  error: pluginRes.error,
                  provenance: tagged,
                };
              })()
            : await toolExecutor.execute(toolDesc.id, toolCallId, effectiveArgs, {
                agent_id: agentId,
                workspace_id: workspaceId,
                session_id: toolExecutionContext.sessionId,
                channel: toolExecutionContext.channel,
                thread_id: toolExecutionContext.threadId,
                execution_run_id: toolExecutionContext.execution?.runId,
                execution_step_id: toolExecutionContext.execution?.stepId,
                policy_snapshot_id: policySnapshotId,
              });

          if (pluginRes && this.opts.container.redactionEngine) {
            const redact = (text: string): string =>
              this.opts.container.redactionEngine?.redactText(text).redacted ?? text;
            res.output = redact(res.output);
            if (res.error) {
              res.error = redact(res.error);
            }
            if (res.provenance) {
              res.provenance = {
                ...res.provenance,
                content: redact(res.provenance.content),
              };
            }
          }

          if (res.provenance) {
            drivingProvenance = {
              source: res.provenance.source,
              trusted: res.provenance.trusted,
            };
          }

          let content = res.error ? JSON.stringify({ error: res.error }) : res.output;

          if (
            res.provenance &&
            !res.provenance.trusted &&
            containsInjectionPatterns(res.provenance.content)
          ) {
            content = `[SECURITY: This tool output contained potential prompt injection patterns that were neutralized.]\n${content}`;
          }

          contextReport.tool_calls.push({
            tool_call_id: toolCallId,
            tool_id: toolDesc.id,
            injected_chars: content.length,
          });

          if (res.meta?.kind === "fs.read") {
            contextReport.injected_files.push({
              tool_call_id: toolCallId,
              path: res.meta.path,
              offset: res.meta.offset,
              limit: res.meta.limit,
              raw_chars: res.meta.raw_chars,
              selected_chars: res.meta.selected_chars,
              injected_chars: content.length,
              truncated: res.meta.truncated,
              truncation_marker: res.meta.truncation_marker,
            });
          }

          return content;
        },
      });
    }

    return result;
  }

  private async awaitApprovalForToolExecution(
    tool: ToolDescriptor,
    args: unknown,
    toolCallId: string,
    context: ToolExecutionContext,
    stepIndex: number,
    policyContext?: {
      policy_snapshot_id?: string;
      agent_id?: string;
      workspace_id?: string;
      suggested_overrides?: unknown;
      applied_override_ids?: string[];
    },
  ): Promise<{
    approved: boolean;
    status: ApprovalStatus;
    approvalId: number;
    reason?: string;
  }> {
    const deadline = Date.now() + this.approvalWaitMs;
    const approval = await this.approvalDal.create({
      planId: context.planId,
      stepIndex,
      kind: "workflow_step",
      agentId: this.agentId,
      workspaceId: this.workspaceId,
      prompt: `Approve execution of '${tool.id}' (risk=${tool.risk})`,
      context: {
        source: "agent-tool-execution",
        tool_id: tool.id,
        tool_risk: tool.risk,
        tool_call_id: toolCallId,
        args,
        session_id: context.sessionId,
        channel: context.channel,
        thread_id: context.threadId,
        policy: policyContext ?? undefined,
      },
      expiresAt: new Date(deadline).toISOString(),
    });

    this.opts.container.logger.info("approval.created", {
      approval_id: approval.id,
      plan_id: context.planId,
      step_index: stepIndex,
      tool_id: tool.id,
      tool_risk: tool.risk,
      tool_call_id: toolCallId,
      expires_at: approval.expires_at,
    });

    this.approvalNotifier.notify(approval);

    while (Date.now() < deadline) {
      await this.approvalDal.expireStale();
      const current = await this.approvalDal.getById(approval.id);
      if (!current) {
        return {
          approved: false,
          status: "expired",
          approvalId: approval.id,
          reason: "approval record not found",
        };
      }

      if (current.status === "approved") {
        return {
          approved: true,
          status: "approved",
          approvalId: current.id,
          reason: current.response_reason ?? undefined,
        };
      }

      if (current.status === "denied" || current.status === "expired") {
        return {
          approved: false,
          status: current.status,
          approvalId: current.id,
          reason: current.response_reason ?? undefined,
        };
      }

      const sleepMs = Math.min(this.approvalPollMs, Math.max(1, deadline - Date.now()));
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }

    const expired = await this.approvalDal.expireById(approval.id);
    return {
      approved: false,
      status: "expired",
      approvalId: approval.id,
      reason: expired?.response_reason ?? "approval timed out",
    };
  }

  private async resolvePolicyGatedPluginToolExposure(params: {
    allowlist: readonly string[];
    pluginTools: readonly ToolDescriptor[];
  }): Promise<{ allowlist: string[]; pluginTools: ToolDescriptor[] }> {
    const policy = this.policyService;

    const pluginTools = params.pluginTools
      .map((tool) => {
        const id = tool.id.trim();
        if (!id) return undefined;
        if (id === tool.id) return tool;
        return { ...tool, id };
      })
      .filter((tool): tool is ToolDescriptor => Boolean(tool));

    const sideEffecting = pluginTools.filter(isSideEffectingPluginTool);
    if (sideEffecting.length === 0) {
      return { allowlist: [...params.allowlist], pluginTools };
    }

    if (!policy.isEnabled() || policy.isObserveOnly()) {
      return { allowlist: [...params.allowlist], pluginTools };
    }

    try {
      const effective = await policy.loadEffectiveBundle();
      const toolsDomain = effective.bundle.tools;
      const deny = toolsDomain?.deny ?? [];
      const allow = toolsDomain?.allow ?? [];
      const requireApproval = toolsDomain?.require_approval ?? [];

      const isOptedIn = (toolId: string): boolean => {
        for (const pat of deny) {
          if (wildcardMatch(pat, toolId)) return false;
        }
        for (const pat of requireApproval) {
          if (wildcardMatch(pat, toolId)) return true;
        }
        for (const pat of allow) {
          if (wildcardMatch(pat, toolId)) return true;
        }
        return false;
      };

      const gatedPluginTools = pluginTools.filter(
        (tool) => !isSideEffectingPluginTool(tool) || isOptedIn(tool.id),
      );

      const allowlist = new Set<string>(params.allowlist);
      for (const tool of gatedPluginTools) {
        if (isSideEffectingPluginTool(tool)) {
          allowlist.add(tool.id);
        }
      }

      return { allowlist: [...allowlist], pluginTools: gatedPluginTools };
    } catch {
      // Intentional: fail closed; side-effecting plugin tools are opt-in and require a readable policy bundle.
      const gatedPluginTools = pluginTools.filter((tool) => !isSideEffectingPluginTool(tool));
      return { allowlist: [...params.allowlist], pluginTools: gatedPluginTools };
    }
  }
}
