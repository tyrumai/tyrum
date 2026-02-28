import { randomUUID } from "node:crypto";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { generateText, stepCountIs, streamText } from "ai";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import type {
  AgentStatusResponse as AgentStatusResponseT,
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
  AgentConfig as AgentConfigT,
  McpServerSpec as McpServerSpecT,
  IdentityPack as IdentityPackT,
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
import {
  prepareLaneQueueStep as prepareLaneQueueStepBridge,
  turnViaExecutionEngine as turnViaExecutionEngineBridge,
  type LaneQueueScope,
  type LaneQueueState,
  type TurnEngineBridgeDeps,
} from "./turn-engine-bridge.js";
import { maybeRunPreCompactionMemoryFlush } from "./pre-compaction-memory-flush.js";
import { ToolSetBuilder, type ToolCallPolicyState } from "./tool-set-builder.js";
import {
  ToolExecutionApprovalRequiredError,
  createStaticLanguageModelV3,
  deriveElevatedExecutionAvailable,
  deriveWorkItemTitle,
  extractToolApprovalResumeState,
  isStatusQuery,
  parseIntakeModeDecision,
  resolveAgentId,
  resolveAgentTurnInput,
  resolveLaneQueueScope,
  type ResolvedAgentTurnInput,
  resolveMainLaneSessionKey,
  resolveTurnRequestId,
  shouldPromoteToCoreMemory,
  type StepPauseRequest,
} from "./turn-helpers.js";
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
import { looksLikeSecretText } from "./secrets.js";
import type { AgentContextReport, AgentRuntimeOptions } from "./types.js";
import { ensureWorkspaceInitialized, resolveTyrumHome } from "../home.js";
import {
  decideCrossTurnLoopWarning,
  detectWithinTurnToolLoop,
  LOOP_WARNING_PREFIX,
} from "../loop-detection.js";
import { MarkdownMemoryStore } from "../markdown-memory.js";
import { SessionDal, type SessionRow } from "../session-dal.js";
import {
  loadAgentConfig,
  loadEnabledMcpServers,
  loadEnabledSkills,
  loadIdentity,
  type LoadedSkillManifest,
} from "../workspace.js";
import { isToolAllowed, selectToolDirectory } from "../tools.js";
import { getExecutionProfile, normalizeExecutionProfileId } from "../execution-profiles.js";
import type { ExecutionProfile, ExecutionProfileId } from "../execution-profiles.js";
import { IntakeModeOverrideDal } from "../intake-mode-override-dal.js";
import { McpManager } from "../mcp-manager.js";
import { NodeDispatchService } from "../node-dispatch-service.js";
import { ToolExecutor } from "../tool-executor.js";
import { tagContent } from "../provenance.js";
import { sanitizeForModel } from "../sanitizer.js";
import { EnvSecretProvider } from "../../secret/provider.js";
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
import type { ApprovalDal } from "../../approval/dal.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "../../policy/service.js";
import { createProviderFromNpm } from "../../models/provider-factory.js";
import {
  appendToolApprovalResponseMessage,
  countAssistantMessages,
} from "../../ai-sdk/message-utils.js";
import { coerceRecord } from "../../util/coerce.js";
import { ExecutionEngine } from "../../execution/engine.js";
import { resolveSandboxHardeningProfile } from "../../sandbox/hardening.js";
import { LaneQueueSignalDal } from "../../lanes/queue-signal-dal.js";
import { resolveWorkspaceId } from "../../workspace/id.js";
import { WorkboardDal } from "../../workboard/dal.js";

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_APPROVAL_WAIT_MS = 120_000;
const DEFAULT_APPROVAL_POLL_MS = 500;
const MAX_TURN_ENGINE_WAIT_MS = 60_000;

const WITHIN_TURN_LOOP_STOP_REPLY =
  "Loop detected (repeated tool calls); stopping to avoid runaway execution. " +
  "If you want me to continue, adjust the request/constraints or ask me to try a different approach.";

const CROSS_TURN_LOOP_WARNING_TEXT =
  `${LOOP_WARNING_PREFIX} I may be repeating myself. If this isn’t progressing, tell me what to change ` +
  "(goal/constraints/example output) and I’ll take a different approach.";

interface AgentLoadedContext {
  config: AgentConfigT;
  identity: IdentityPackT;
  skills: LoadedSkillManifest[];
  mcpServers: McpServerSpecT[];
  memoryStore: MarkdownMemoryStore;
}

type TurnExecutionContext = {
  planId: string;
  runId: string;
  stepIndex: number;
  stepId: string;
  stepApprovalId?: number;
};

type ResolvedExecutionProfile = {
  id: ExecutionProfileId;
  profile: ExecutionProfile;
  source: "interaction_default" | "subagent_record" | "subagent_fallback";
};

const NOOP_APPROVAL_NOTIFIER: ApprovalNotifier = {
  notify(_approval) {
    // no-op
  },
};

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
    const configuredInstanceOwner = opts.container.gatewayConfig?.runtime.instanceId?.trim();
    this.instanceOwner =
      configuredInstanceOwner ||
      process.env["TYRUM_INSTANCE_ID"]?.trim() ||
      `instance-${randomUUID()}`;
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

    await maybeRunPreCompactionMemoryFlush(
      { db: this.opts.container.db, logger: this.opts.container.logger, agentId: this.agentId },
      { ctx, session, model, systemPrompt },
    );

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
        // ignore WIP or transition errors; the WorkItem still exists for operator triage.
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

    await maybeRunPreCompactionMemoryFlush(
      { db: this.opts.container.db, logger: this.opts.container.logger, agentId: this.agentId },
      {
        ctx,
        session,
        model,
        systemPrompt,
        abortSignal: opts?.abortSignal,
        timeoutMs: opts?.timeoutMs,
      },
    );

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
    const toolSetBuilder = new ToolSetBuilder({
      home: this.home,
      agentId: this.agentId,
      workspaceId: this.workspaceId,
      policyService: this.policyService,
      approvalDal: this.approvalDal,
      approvalNotifier: this.approvalNotifier,
      approvalWaitMs: this.approvalWaitMs,
      approvalPollMs: this.approvalPollMs,
      logger: this.opts.container.logger,
      secretProvider: this.opts.secretProvider,
      plugins: this.plugins,
      redactionEngine: this.opts.container.redactionEngine,
    });
    const { allowlist: toolAllowlist, pluginTools } =
      await toolSetBuilder.resolvePolicyGatedPluginToolExposure({
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
    const toolSet = toolSetBuilder.buildToolSet(
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
      // ignore override lookup failures; fall back to default inline
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
}
