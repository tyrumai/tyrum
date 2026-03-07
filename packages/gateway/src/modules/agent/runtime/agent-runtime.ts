import { randomUUID } from "node:crypto";
import { generateText, stepCountIs, streamText } from "ai";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import type {
  AgentStatusResponse as AgentStatusResponseT,
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
  AgentConfig as AgentConfigT,
  McpServerSpec as McpServerSpecT,
  NormalizedContainerKind,
  SecretHandle as SecretHandleT,
  WorkScope,
} from "@tyrum/schemas";
import {
  AgentKey,
  AgentStatusResponse,
  ContextReport as ContextReportSchema,
  SubagentSessionKey,
  WorkspaceKey,
} from "@tyrum/schemas";
import {
  prepareLaneQueueStep as prepareLaneQueueStepBridge,
  turnViaExecutionEngine as turnViaExecutionEngineBridge,
  type LaneQueueScope,
  type LaneQueueState,
  type TurnEngineBridgeDeps,
} from "./turn-engine-bridge.js";
import { WITHIN_TURN_LOOP_STOP_REPLY } from "./runtime-constants.js";
import { maybeRunPreCompactionMemoryFlush } from "./pre-compaction-memory-flush.js";
import { buildDefaultAgentConfig } from "../default-config.js";
import { createDefaultAgentContextStore, type AgentContextStore } from "../context-store.js";
import { loadCurrentAgentContext } from "../load-context.js";
import { ToolSetBuilder, type ToolCallPolicyState } from "./tool-set-builder.js";
import {
  buildSandboxPrompt,
  ToolExecutionApprovalRequiredError,
  createStaticLanguageModelV3,
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
  type StepPauseRequest,
} from "./turn-helpers.js";
import {
  DATA_TAG_SAFETY_PROMPT,
  formatIdentityPrompt,
  formatSessionContext,
  formatSkillsPrompt,
  formatToolPrompt,
} from "./prompts.js";
import { resolveSessionModel as resolveSessionModelImpl } from "./session-model-resolution.js";
import { resolveEmbeddingPipeline } from "./embedding-pipeline-resolution.js";
import { finalizeTurn } from "./turn-finalization.js";
import { buildWorkFocusDigest } from "./work-focus-digest.js";
import type { AgentContextReport, AgentLoadedContext, AgentRuntimeOptions } from "./types.js";
import { resolveTyrumHome } from "../home.js";
import { detectWithinTurnToolLoop } from "../loop-detection.js";
import { SessionDal, type SessionRow } from "../session-dal.js";
import { AgentConfigDal } from "../../config/agent-config-dal.js";
import { isToolAllowed, selectToolDirectory } from "../tools.js";
import { getExecutionProfile, normalizeExecutionProfileId } from "../execution-profiles.js";
import type { ExecutionProfile, ExecutionProfileId } from "../execution-profiles.js";
import { IntakeModeOverrideDal } from "../intake-mode-override-dal.js";
import { McpManager } from "../mcp-manager.js";
import { NodeDispatchService } from "../node-dispatch-service.js";
import { ToolExecutor } from "../tool-executor.js";
import { tagContent } from "../provenance.js";
import { sanitizeForModel } from "../sanitizer.js";
import { MemoryV1Dal } from "../../memory/v1-dal.js";
import { buildMemoryV1Digest } from "../../memory/v1-digest.js";
import {
  MemoryV1SemanticIndex,
  type MemoryV1SemanticSearchHit,
} from "../../memory/v1-semantic-index.js";
import type { ApprovalNotifier } from "../../approval/notifier.js";
import type { ApprovalDal } from "../../approval/dal.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "../../policy/service.js";
import {
  appendToolApprovalResponseMessage,
  countAssistantMessages,
} from "../../ai-sdk/message-utils.js";
import { coerceRecord } from "../../util/coerce.js";
import { ExecutionEngine } from "../../execution/engine.js";
import { resolveSandboxHardeningProfile } from "../../sandbox/hardening.js";
import { LaneQueueSignalDal } from "../../lanes/queue-signal-dal.js";
import { resolveWorkspaceKey } from "../../workspace/id.js";
import { WorkboardDal } from "../../workboard/dal.js";
import { ChannelOutboxDal } from "../../channels/outbox-dal.js";
import { DEFAULT_CHANNEL_ACCOUNT_ID, parseChannelSourceKey } from "../../channels/interface.js";
import { SessionSendPolicyOverrideDal } from "../../channels/send-policy-override-dal.js";
import { DEFAULT_TENANT_ID } from "../../identity/scope.js";
import { ScheduleService } from "../../automation/schedule-service.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_APPROVAL_WAIT_MS = 120_000;
const DEFAULT_APPROVAL_POLL_MS = 500;
const MAX_TURN_ENGINE_WAIT_MS = 60_000;

function makeEventfulAbortSignal(upstream: AbortSignal | undefined): AbortSignal | undefined {
  if (!upstream) return undefined;
  const controller = new AbortController();

  const abortLater = () => {
    queueMicrotask(() => controller.abort());
  };

  upstream.addEventListener("abort", abortLater, { once: true });
  if (upstream.aborted) {
    abortLater();
  }

  return controller.signal;
}

type TurnExecutionContext = {
  planId: string;
  runId: string;
  stepIndex: number;
  stepId: string;
  stepApprovalId?: string;
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

type AutomationTurnMetadata = {
  schedule_id?: string;
  watcher_key?: string;
  schedule_kind?: "heartbeat" | "cron";
  fired_at?: string;
  previous_fired_at?: string | null;
  cadence?: unknown;
  delivery_mode?: "quiet" | "notify";
  instruction?: string;
  seeded_default?: boolean;
};

function resolveAutomationMetadata(
  metadata: Record<string, unknown> | undefined,
): AutomationTurnMetadata | undefined {
  const automation = coerceRecord(metadata?.["automation"]);
  if (!automation) return undefined;

  const kindRaw = automation["schedule_kind"];
  const deliveryModeRaw = automation["delivery_mode"];
  const scheduleKind = kindRaw === "heartbeat" || kindRaw === "cron" ? kindRaw : undefined;
  const deliveryMode =
    deliveryModeRaw === "quiet" || deliveryModeRaw === "notify" ? deliveryModeRaw : undefined;
  if (!scheduleKind) return undefined;

  return {
    schedule_id:
      typeof automation["schedule_id"] === "string" ? automation["schedule_id"] : undefined,
    watcher_key:
      typeof automation["watcher_key"] === "string" ? automation["watcher_key"] : undefined,
    schedule_kind: scheduleKind,
    fired_at: typeof automation["fired_at"] === "string" ? automation["fired_at"] : undefined,
    previous_fired_at:
      typeof automation["previous_fired_at"] === "string" ||
      automation["previous_fired_at"] === null
        ? (automation["previous_fired_at"] as string | null)
        : undefined,
    cadence: automation["cadence"],
    delivery_mode: deliveryMode,
    instruction:
      typeof automation["instruction"] === "string" ? automation["instruction"] : undefined,
    seeded_default: automation["seeded_default"] === true,
  };
}

export class AgentRuntime {
  private readonly home: string;
  private readonly contextStore: AgentContextStore;
  private readonly sessionDal: SessionDal;
  private readonly fetchImpl: typeof fetch;
  private readonly tenantId: string;
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
  private readonly defaultHeartbeatSeededScopes = new Set<string>();

  constructor(private readonly opts: AgentRuntimeOptions) {
    this.home = opts.home ?? resolveTyrumHome();
    this.contextStore =
      opts.contextStore ??
      createDefaultAgentContextStore({
        home: this.home,
        container: opts.container,
      });
    this.sessionDal = opts.sessionDal ?? opts.container.sessionDal;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.tenantId = opts.tenantId?.trim() || DEFAULT_TENANT_ID;

    const agentIdCandidate = opts.agentId?.trim() || resolveAgentId();
    const parsedAgentId = AgentKey.safeParse(agentIdCandidate);
    if (!parsedAgentId.success) {
      throw new Error(`invalid agent_id '${agentIdCandidate}' (${parsedAgentId.error.message})`);
    }
    this.agentId = parsedAgentId.data;

    const workspaceIdCandidate = opts.workspaceId?.trim() || resolveWorkspaceKey();
    const parsedWorkspaceId = WorkspaceKey.safeParse(workspaceIdCandidate);
    if (!parsedWorkspaceId.success) {
      throw new Error(
        `invalid workspace_id '${workspaceIdCandidate}' (${parsedWorkspaceId.error.message})`,
      );
    }
    this.workspaceId = parsedWorkspaceId.data;
    const configuredInstanceOwner = opts.instanceOwner?.trim();
    this.instanceOwner = configuredInstanceOwner || `instance-${randomUUID()}`;
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

  private async loadAgentConfigFromDb(scope: {
    tenantId: string;
    agentId: string;
  }): Promise<AgentConfigT> {
    return (
      await new AgentConfigDal(this.opts.container.db).ensureSeeded({
        tenantId: scope.tenantId,
        agentId: scope.agentId,
        defaultConfig: buildDefaultAgentConfig(
          resolveGatewayStateMode(this.opts.container.deploymentConfig),
        ),
        createdBy: { kind: "agent-runtime" },
        reason: "seed",
      })
    ).config;
  }
  private maybeCleanupSessions(ttlDays: number, agentKey: string): void {
    const now = Date.now();
    if (now < this.cleanupAtMs) {
      return;
    }
    void this.sessionDal.deleteExpired(ttlDays, agentKey);
    this.cleanupAtMs = now + 60 * 60 * 1000;
  }

  private async resolveSessionModel(input: {
    config: AgentConfigT;
    tenantId: string;
    sessionId: string;
    executionProfileId?: ExecutionProfileId;
    profileModelId?: string;
    fetchImpl?: typeof fetch;
  }): Promise<LanguageModel> {
    return await resolveSessionModelImpl(
      {
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

    const agentId = await this.opts.container.identityScopeDal.ensureAgentId(
      this.tenantId,
      this.agentId,
    );
    const workspaceId = await this.opts.container.identityScopeDal.ensureWorkspaceId(
      this.tenantId,
      this.workspaceId,
    );
    await this.opts.container.identityScopeDal.ensureMembership(
      this.tenantId,
      agentId,
      workspaceId,
    );
    await this.ensureDefaultHeartbeatSchedule(agentId, workspaceId);
    const config = await this.loadAgentConfigFromDb({
      tenantId: this.tenantId,
      agentId,
    });
    const ctx = await loadCurrentAgentContext({
      contextStore: this.contextStore,
      tenantId: this.tenantId,
      agentId,
      workspaceId,
      config,
    });
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
    contextPruning: AgentConfigT["sessions"]["context_pruning"] | undefined,
  ): { messages: Array<ModelMessage> } {
    return prepareLaneQueueStepBridge(laneQueue, messages, contextPruning);
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
    opts?: { allowEmpty?: boolean },
  ): string {
    if (withinTurnLoop) {
      if (rawReply.trim().length === 0) return WITHIN_TURN_LOOP_STOP_REPLY;
      if (rawReply.includes(WITHIN_TURN_LOOP_STOP_REPLY)) return rawReply;
      return `${rawReply}\n\n${WITHIN_TURN_LOOP_STOP_REPLY}`;
    }
    if (rawReply.length > 0) return rawReply;
    if (opts?.allowEmpty) return "";
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
        scope: {
          tenant_id: session.tenant_id,
          agent_id: session.agent_id,
          workspace_id: session.workspace_id,
        },
        createdFromSessionKey: mainLaneSessionKey,
      });
      this.lastContextReport = contextReport;
      const response = await finalizeTurn({
        container: this.opts.container,
        sessionDal: this.sessionDal,
        ctx,
        session,
        resolved,
        reply: delegation.reply,
        usedTools,
        contextReport,
      });

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
      {
        db: this.opts.container.db,
        logger: this.opts.container.logger,
        agentId: session.agent_id,
      },
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
      prepareStep: ({ messages: stepMessages }) =>
        this.prepareLaneQueueStep(laneQueue, stepMessages, ctx.config.sessions.context_pruning),
    });

    const finalize = async (): Promise<AgentTurnResponseT> => {
      const result = await streamResult;
      const rawReply = (await result.text) || "";
      const automation = resolveAutomationMetadata(resolved.metadata);
      const reply = this.resolveTurnReply(rawReply, withinTurnLoop.value, {
        allowEmpty: automation?.delivery_mode === "quiet",
      });
      this.lastContextReport = contextReport;
      return await finalizeTurn({
        container: this.opts.container,
        sessionDal: this.sessionDal,
        ctx,
        session,
        resolved,
        reply,
        usedTools,
        contextReport,
      });
    };

    return { streamResult, sessionId: session.session_id, finalize };
  }

  async turn(input: AgentTurnRequestT): Promise<AgentTurnResponseT> {
    return await this.turnViaExecutionEngine(input);
  }

  async executeDecideAction(
    input: AgentTurnRequestT,
    opts?: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: TurnExecutionContext },
  ): Promise<AgentTurnResponseT> {
    const response = await this.turnDirect(input, opts);
    const automation = resolveAutomationMetadata(input.metadata);
    if (automation && response.reply.trim().length > 0) {
      await this.maybeDeliverAutomationReply({
        input,
        response,
        automation,
      });
    }
    return response;
  }

  private async maybeDeliverAutomationReply(input: {
    input: AgentTurnRequestT;
    response: AgentTurnResponseT;
    automation: AutomationTurnMetadata;
  }): Promise<void> {
    const tenantId = this.tenantId;
    const agentKey = input.input.agent_key?.trim() || this.agentId;
    const workspaceKey = input.input.workspace_key?.trim() || this.workspaceId;
    const agentId = await this.opts.container.identityScopeDal.ensureAgentId(tenantId, agentKey);
    const workspaceId = await this.opts.container.identityScopeDal.ensureWorkspaceId(
      tenantId,
      workspaceKey,
    );
    const workboard = new WorkboardDal(this.opts.container.db);
    const activity = await workboard.getScopeActivity({
      scope: { tenant_id: tenantId, agent_id: agentId, workspace_id: workspaceId },
    });
    const targetSessionKey = activity?.last_active_session_key?.trim();
    if (!targetSessionKey) return;
    const sendOverride = await new SessionSendPolicyOverrideDal(this.opts.container.db).get({
      tenant_id: tenantId,
      key: targetSessionKey,
    });
    if (sendOverride?.send_policy === "off") return;

    const route = await this.opts.container.db.get<{
      inbox_id: number;
      tenant_id: string;
      source: string;
      thread_id: string;
      workspace_id: string;
      session_id: string;
      channel_thread_id: string;
    }>(
      `SELECT inbox_id, tenant_id, source, thread_id, workspace_id, session_id, channel_thread_id
       FROM channel_inbox
       WHERE tenant_id = ? AND key = ?
       ORDER BY received_at_ms DESC, inbox_id DESC
       LIMIT 1`,
      [tenantId, targetSessionKey],
    );
    if (!route) return;

    const outbox = new ChannelOutboxDal(this.opts.container.db);
    const dedupeKey = [
      "automation.reply",
      input.automation.schedule_id ?? "unknown",
      input.automation.fired_at ?? "unknown",
      input.response.session_id,
    ].join(":");
    const existing = await outbox.getByDedupeKey({
      tenant_id: route.tenant_id,
      dedupe_key: dedupeKey,
    });
    if (existing) return;

    let decision: "allow" | "deny" | "require_approval" = "allow";
    let policySnapshotId: string | undefined;
    if (this.policyService.isEnabled()) {
      try {
        const parsedSource = parseChannelSourceKey(route.source);
        const matchTarget =
          parsedSource.accountId === DEFAULT_CHANNEL_ACCOUNT_ID
            ? `${parsedSource.connector}:${route.thread_id}`
            : `${parsedSource.connector}:${parsedSource.accountId}:${route.thread_id}`;
        const evaluation = await this.policyService.evaluateConnectorAction({
          tenantId,
          agentId,
          workspaceId,
          matchTarget,
        });
        decision = evaluation.decision;
        policySnapshotId = evaluation.policy_snapshot?.policy_snapshot_id;
      } catch {
        // Intentional: fail closed if connector policy evaluation fails.
        decision = "require_approval";
      }

      if (this.policyService.isObserveOnly()) {
        decision = "allow";
      }
    }

    if (sendOverride?.send_policy === "on") {
      decision = "allow";
    }

    if (
      decision === "deny" &&
      this.policyService.isEnabled() &&
      !this.policyService.isObserveOnly()
    ) {
      return;
    }

    let approvalId: string | undefined;
    if (decision === "require_approval") {
      const approval = await this.approvalDal.create({
        tenantId,
        agentId,
        workspaceId,
        approvalKey: `connector:automation.reply:${route.source}:${route.thread_id}:${dedupeKey}`,
        kind: "connector.send",
        prompt: `Approve sending an automation reply`,
        context: {
          source: route.source,
          thread_id: route.thread_id,
          inbox_id: route.inbox_id,
          key: targetSessionKey,
          policy_snapshot_id: policySnapshotId,
          automation: {
            schedule_id: input.automation.schedule_id,
            schedule_kind: input.automation.schedule_kind,
            fired_at: input.automation.fired_at,
          },
          preview: input.response.reply,
        },
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      approvalId = approval.approval_id;
      try {
        this.approvalNotifier.notify(approval);
      } catch {
        // Intentional: approval notification is best-effort.
      }
    }

    await outbox.enqueue({
      tenant_id: route.tenant_id,
      inbox_id: route.inbox_id,
      source: route.source,
      thread_id: route.thread_id,
      dedupe_key: dedupeKey,
      chunk_index: 0,
      text: input.response.reply,
      approval_id: approvalId ?? null,
      workspace_id: route.workspace_id,
      session_id: route.session_id,
      channel_thread_id: route.channel_thread_id,
    });
  }

  private async maybeStoreToolApprovalArgsHandle(input: {
    toolId: string;
    toolCallId: string;
    args: unknown;
  }): Promise<SecretHandleT | undefined> {
    const secretProvider = this.opts.secretProvider;
    if (!secretProvider) {
      return undefined;
    }

    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(input.args);
    } catch {
      // Intentional: tool approval arg persistence is best-effort; args may be non-serializable.
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
      // Intentional: tool approval arg persistence is best-effort; continue without stored args handle.
      return undefined;
    }
  }

  private async turnDirect(
    input: AgentTurnRequestT,
    opts?: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: TurnExecutionContext },
  ): Promise<AgentTurnResponseT> {
    const abortSignal = makeEventfulAbortSignal(opts?.abortSignal);
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

    const workScope: WorkScope = {
      tenant_id: session.tenant_id,
      agent_id: session.agent_id,
      workspace_id: session.workspace_id,
    };

    if (isStatusQuery(resolved.message)) {
      let reply = "";
      try {
        const workboard = new WorkboardDal(
          this.opts.container.db,
          this.opts.container.redactionEngine,
        );
        const { items } = await workboard.listItems({
          scope: workScope,
          statuses: ["doing", "blocked", "ready", "backlog"],
          limit: 50,
        });
        if (items.length === 0) {
          reply = "WorkBoard status: no active work items.";
        } else {
          const lines: string[] = ["WorkBoard status:"];
          for (const item of items) {
            lines.push(`- [${item.status}] ${item.work_item_id} — ${item.title}`);
            const tasks = await workboard.listTasks({
              scope: workScope,
              work_item_id: item.work_item_id,
            });
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

      this.lastContextReport = contextReport;
      return await finalizeTurn({
        container: this.opts.container,
        sessionDal: this.sessionDal,
        ctx,
        session,
        resolved,
        reply,
        usedTools,
        contextReport,
      });
    }

    const intakeModeDecision = parseIntakeModeDecision(resolved.message);
    if (intakeModeDecision) {
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
        scope: workScope,
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
        scope: { kind: "agent", ...workScope },
        key: "work.active_work_item_id",
        value_json: item.work_item_id,
        provenance_json: {
          source: "agent-turn",
          mode: intakeModeDecision.mode,
          reason_code: intakeModeDecision.reason_code,
        },
      });

      await workboard.setStateKv({
        scope: { kind: "work_item", ...workScope, work_item_id: item.work_item_id },
        key: "work.intake",
        value_json: { mode: intakeModeDecision.mode, reason_code: intakeModeDecision.reason_code },
      });

      await workboard.createTask({
        scope: workScope,
        task: {
          work_item_id: item.work_item_id,
          status: "queued",
          execution_profile: intakeModeDecision.mode === "delegate_plan" ? "planner" : "executor",
          side_effect_class: "workspace",
        },
      });

      await workboard.transitionItem({
        scope: workScope,
        work_item_id: item.work_item_id,
        status: "ready",
      });
      try {
        await workboard.transitionItem({
          scope: workScope,
          work_item_id: item.work_item_id,
          status: "doing",
        });
      } catch {
        // Intentional: best-effort transition to "doing"; the WorkItem still exists for operator triage.
      }

      const reply = `Delegated work item created: ${item.work_item_id} (mode=${intakeModeDecision.mode}, reason=${intakeModeDecision.reason_code})`;
      this.lastContextReport = contextReport;
      return await finalizeTurn({
        container: this.opts.container,
        sessionDal: this.sessionDal,
        ctx,
        session,
        resolved,
        reply,
        usedTools,
        contextReport,
      });
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
        scope: workScope,
        createdFromSessionKey: mainLaneSessionKey,
      });
      this.lastContextReport = contextReport;
      return await finalizeTurn({
        container: this.opts.container,
        sessionDal: this.sessionDal,
        ctx,
        session,
        resolved,
        reply: delegation.reply,
        usedTools,
        contextReport,
      });
    }

    await maybeRunPreCompactionMemoryFlush(
      {
        db: this.opts.container.db,
        logger: this.opts.container.logger,
        agentId: session.agent_id,
      },
      {
        ctx,
        session,
        model,
        systemPrompt,
        abortSignal,
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
      const approval = await this.approvalDal.getById({
        tenantId: session.tenant_id,
        approvalId: stepApprovalId,
      });
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
            reason: (() => {
              const resolution = coerceRecord(approval.resolution);
              const reason =
                typeof resolution?.["reason"] === "string" ? resolution["reason"].trim() : "";
              if (reason.length > 0) return reason;
              return approval.status === "expired"
                ? "approval expired"
                : approval.status === "cancelled"
                  ? "approval cancelled"
                  : undefined;
            })(),
          });
        }
      }
    }

    const remainingSteps = this.maxSteps - stepsUsedSoFar;
    if (remainingSteps <= 0) {
      const automation = resolveAutomationMetadata(resolved.metadata);
      const reply = automation?.delivery_mode === "quiet" ? "" : "No assistant response returned.";
      this.lastContextReport = contextReport;
      return await finalizeTurn({
        container: this.opts.container,
        sessionDal: this.sessionDal,
        ctx,
        session,
        resolved,
        reply,
        usedTools,
        contextReport,
      });
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
      prepareStep: ({ messages: stepMessages }) =>
        this.prepareLaneQueueStep(laneQueue, stepMessages, ctx.config.sessions.context_pruning),
      abortSignal,
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
        agent_id: session.agent_id,
        workspace_id: session.workspace_id,
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
    const automation = resolveAutomationMetadata(resolved.metadata);
    const reply = this.resolveTurnReply(rawReply, withinTurnLoop.value, {
      allowEmpty: automation?.delivery_mode === "quiet",
    });
    this.lastContextReport = contextReport;
    return await finalizeTurn({
      container: this.opts.container,
      sessionDal: this.sessionDal,
      ctx,
      session,
      resolved,
      reply,
      usedTools,
      contextReport,
    });
  }

  private async turnViaExecutionEngine(input: AgentTurnRequestT): Promise<AgentTurnResponseT> {
    const deps = {
      tenantId: this.tenantId,
      agentKey: this.agentId,
      workspaceKey: this.workspaceId,
      identityScopeDal: this.opts.container.identityScopeDal,
      executionEngine: this.executionEngine,
      executionWorkerId: this.executionWorkerId,
      turnEngineWaitMs: this.turnEngineWaitMs,
      approvalPollMs: this.approvalPollMs,
      db: this.opts.container.db,
      approvalDal: this.approvalDal,
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
    tenantId: string,
    agentId: string,
  ): Promise<MemoryV1SemanticSearchHit[]> {
    try {
      const pipeline = await resolveEmbeddingPipeline({
        container: this.opts.container,
        secretProvider: this.opts.secretProvider,
        instanceOwner: this.instanceOwner,
        fetchImpl: this.fetchImpl,
        primaryModelId,
        sessionId,
        tenantId,
        agentId,
      });
      if (!pipeline) return [];
      const index = new MemoryV1SemanticIndex({
        db: this.opts.container.db,
        tenantId,
        agentId,
        embedder: {
          modelId: "runtime/embedding",
          embed: async (text: string) => pipeline.embed(text),
        },
      });
      return await index.search(query, limit);
    } catch {
      // Intentional: semantic search is best-effort; fall back to no hits on failure.
      return [];
    }
  }

  private async buildAutomationDigest(input: {
    scope: WorkScope;
    automation: AutomationTurnMetadata;
  }): Promise<string> {
    const workboard = new WorkboardDal(this.opts.container.db, this.opts.container.redactionEngine);
    const [itemsResult, signalsResult, activity, pendingApprovals, recentEvents] =
      await Promise.all([
        workboard.listItems({
          scope: input.scope,
          statuses: ["doing", "blocked", "ready", "backlog"],
          limit: 10,
        }),
        workboard.listSignals({
          scope: input.scope,
          statuses: ["active"],
          limit: 10,
        }),
        workboard.getScopeActivity({ scope: input.scope }),
        this.opts.container.db.all<{
          approval_id: string;
          kind: string;
          prompt: string;
          created_at: string;
        }>(
          `SELECT approval_id, kind, prompt, created_at
           FROM approvals
           WHERE tenant_id = ?
             AND agent_id = ?
             AND workspace_id = ?
             AND status = 'pending'
           ORDER BY created_at DESC
           LIMIT 10`,
          [input.scope.tenant_id, input.scope.agent_id, input.scope.workspace_id],
        ),
        input.automation.previous_fired_at
          ? this.opts.container.db.all<{
              work_item_id: string;
              title: string;
              kind: string;
              created_at: string;
            }>(
              `SELECT e.work_item_id, i.title, e.kind, e.created_at
               FROM work_item_events e
               JOIN work_items i
                 ON i.tenant_id = e.tenant_id
                AND i.work_item_id = e.work_item_id
               WHERE i.tenant_id = ?
                 AND i.agent_id = ?
                 AND i.workspace_id = ?
                 AND e.created_at > ?
               ORDER BY e.created_at DESC
               LIMIT 10`,
              [
                input.scope.tenant_id,
                input.scope.agent_id,
                input.scope.workspace_id,
                input.automation.previous_fired_at,
              ],
            )
          : Promise.resolve([]),
      ]);

    const lines: string[] = [];
    lines.push("Automation digest:");
    lines.push(
      `- Schedule kind: ${input.automation.schedule_kind ?? "unknown"}${input.automation.seeded_default ? " (seeded default)" : ""}`,
    );
    lines.push(`- Last active session: ${activity?.last_active_session_key ?? "none"}`);
    lines.push(`- Active work items: ${String(itemsResult.items.length)}`);
    for (const item of itemsResult.items.slice(0, 5)) {
      lines.push(`  - [${item.status}] ${item.title}`);
    }
    lines.push(`- Active signals: ${String(signalsResult.signals.length)}`);
    for (const signal of signalsResult.signals.slice(0, 5)) {
      lines.push(`  - ${signal.trigger_kind} (${signal.signal_id})`);
    }
    lines.push(`- Pending approvals: ${String(pendingApprovals.length)}`);
    for (const approval of pendingApprovals.slice(0, 5)) {
      lines.push(`  - ${approval.kind}: ${approval.prompt}`);
    }
    if (recentEvents.length > 0) {
      lines.push("- Recent work item events since previous automation run:");
      for (const event of recentEvents.slice(0, 5)) {
        lines.push(`  - ${event.created_at}: ${event.kind} on ${event.title}`);
      }
    }

    return lines.join("\n");
  }

  private async ensureDefaultHeartbeatSchedule(
    agentId: string,
    workspaceId: string,
  ): Promise<void> {
    if (!this.opts.container.deploymentConfig.automation.enabled) {
      return;
    }
    const scopeKey = `${this.tenantId}:${agentId}:${workspaceId}`;
    if (this.defaultHeartbeatSeededScopes.has(scopeKey)) {
      return;
    }

    const scheduleService = new ScheduleService(
      this.opts.container.db,
      this.opts.container.identityScopeDal,
    );
    await scheduleService.ensureDefaultHeartbeatScheduleForMembership({
      tenantId: this.tenantId,
      agentId,
      workspaceId,
    });
    this.defaultHeartbeatSeededScopes.add(scopeKey);
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
    const resolved = resolveAgentTurnInput(input);
    const automation = resolveAutomationMetadata(resolved.metadata);
    const laneQueueScope = resolveLaneQueueScope(resolved.metadata);
    const agentKey = input.agent_key?.trim() || this.agentId;
    const workspaceKey = input.workspace_key?.trim() || this.workspaceId;

    const agentId = await this.opts.container.identityScopeDal.ensureAgentId(
      this.tenantId,
      agentKey,
    );
    const workspaceId = await this.opts.container.identityScopeDal.ensureWorkspaceId(
      this.tenantId,
      workspaceKey,
    );
    await this.opts.container.identityScopeDal.ensureMembership(
      this.tenantId,
      agentId,
      workspaceId,
    );
    await this.ensureDefaultHeartbeatSchedule(agentId, workspaceId);

    const config = await this.loadAgentConfigFromDb({
      tenantId: this.tenantId,
      agentId,
    });
    const ctx = await loadCurrentAgentContext({
      contextStore: this.contextStore,
      tenantId: this.tenantId,
      agentId,
      workspaceId,
      config,
    });
    this.maybeCleanupSessions(ctx.config.sessions.ttl_days, agentKey);

    const containerKind: NormalizedContainerKind =
      input.container_kind ?? resolved.envelope?.container.kind ?? "channel";

    const parsedChannel = parseChannelSourceKey(resolved.channel);
    const connectorKey = parsedChannel.connector;
    const accountKey = resolved.envelope?.delivery.account ?? parsedChannel.accountId;

    const session = await this.sessionDal.getOrCreate({
      tenantId: this.tenantId,
      scopeKeys: {
        agentKey,
        workspaceKey,
      },
      connectorKey,
      accountKey,
      providerThreadId: resolved.thread_id,
      containerKind,
    });

    const laneQueue: LaneQueueState | undefined = laneQueueScope
      ? {
          tenant_id: session.tenant_id,
          scope: laneQueueScope,
          signals: new LaneQueueSignalDal(this.opts.container.db),
          interruptError: undefined,
          cancelToolCalls: false,
          pendingInjectionTexts: [],
        }
      : undefined;

    const mainLaneSessionKey = resolveMainLaneSessionKey({
      agentId: agentKey,
      workspaceId: workspaceKey,
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
                tenantId: session.tenant_id,
                agentId: session.agent_id,
                query: resolved.message,
                config: ctx.config.memory.v1,
                semanticSearch: ctx.config.memory.v1.semantic.enabled
                  ? (query, limit) =>
                      this.semanticSearch(
                        query,
                        limit,
                        ctx.config.model.model,
                        session.session_id,
                        session.tenant_id,
                        session.agent_id,
                      )
                  : undefined,
              });
            } catch (error) {
              this.opts.container.logger.warn("memory.v1.digest_failed", {
                session_id: session.session_id,
                agent_id: session.agent_id,
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
      stateMode: resolveGatewayStateMode(this.opts.container.deploymentConfig),
      tenantId: session.tenant_id,
      agentId: session.agent_id,
      workspaceId: session.workspace_id,
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
      true,
      resolveGatewayStateMode(this.opts.container.deploymentConfig),
    );
    const filteredTools = toolCandidates
      .filter((tool) => isToolAllowed(executionProfile.profile.tool_allowlist, tool.id))
      .slice(0, 8);
    // Build MCP server spec lookup for ToolExecutor
    const mcpSpecMap = new Map<string, McpServerSpecT>(
      ctx.mcpServers.map((server) => [server.id, server]),
    );

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
        tenantId: session.tenant_id,
        agentId: session.agent_id,
        workspaceId: session.workspace_id,
        ownerPrefix: this.instanceOwner,
      },
      nodeDispatchService,
      this.opts.container.artifactStore,
      this.opts.container.identityScopeDal,
    );

    const sessionCtx = formatSessionContext(session.summary, session.turns);
    const workFocusDigest =
      isStatusQuery(resolved.message) || parseIntakeModeDecision(resolved.message)
        ? "Skipped for command turns."
        : await buildWorkFocusDigest({
            container: this.opts.container,
            scope: {
              tenant_id: session.tenant_id,
              agent_id: session.agent_id,
              workspace_id: session.workspace_id,
            },
          });

    const identityPrompt = formatIdentityPrompt(ctx.identity);
    const safetyPrompt = DATA_TAG_SAFETY_PROMPT;
    const hardeningProfile = resolveSandboxHardeningProfile(
      this.opts.container.deploymentConfig.toolrunner.hardeningProfile,
    );
    const sandboxPrompt = await buildSandboxPrompt({
      policyService: this.policyService,
      hardeningProfile,
      tenantId: this.tenantId,
      agentId: session.agent_id,
    });
    const systemPrompt = `${identityPrompt}\n\n${safetyPrompt}\n\n${sandboxPrompt}`;
    const skillsText = `Enabled skills:\n${formatSkillsPrompt(ctx.skills)}`;
    const toolsText = `Available tools:\n${formatToolPrompt(filteredTools)}`;
    const sessionText = `Session context:\n${sessionCtx}`;
    const workFocusText = `Work focus digest:\n${workFocusDigest}`;
    const memoryTagged = tagContent(memoryDigestResult.digest, "memory", false);
    const memoryText = `Memory digest:\n${sanitizeForModel(memoryTagged)}`;
    const automationTriggerText = automation
      ? `Automation trigger:\n${[
          `Schedule kind: ${automation.schedule_kind ?? "unknown"}`,
          `Schedule id: ${automation.schedule_id ?? "unknown"}`,
          `Fired at: ${automation.fired_at ?? "unknown"}`,
          `Previous fired at: ${automation.previous_fired_at ?? "never"}`,
          `Delivery mode: ${automation.delivery_mode ?? "notify"}`,
          automation.instruction ? `Instruction: ${automation.instruction}` : undefined,
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n")}`
      : undefined;
    const automationDigestText = automation
      ? await this.buildAutomationDigest({
          scope: {
            tenant_id: session.tenant_id,
            agent_id: session.agent_id,
            workspace_id: session.workspace_id,
          },
          automation,
        })
      : undefined;

    const toolSchemaParts = filteredTools.map((t) => {
      const schema = t.inputSchema ?? { type: "object", additionalProperties: true };
      let chars = 0;
      try {
        chars = JSON.stringify(schema).length;
      } catch {
        // Intentional: schema size accounting is best-effort; treat non-serializable schemas as 0 chars.
        chars = 0;
      }
      return { id: t.id, chars };
    });
    const toolSchemaTotalChars = toolSchemaParts.reduce((total, part) => total + part.chars, 0);
    const toolSchemaTop = toolSchemaParts.toSorted((a, b) => b.chars - a.chars).slice(0, 5);

    const contextReportId = randomUUID();
    const report: AgentContextReport = {
      context_report_id: contextReportId,
      generated_at: new Date().toISOString(),
      session_id: session.session_id,
      channel: resolved.channel,
      thread_id: resolved.thread_id,
      agent_id: session.agent_id,
      workspace_id: session.workspace_id,
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
        ...(automationTriggerText
          ? [{ id: "automation_trigger", chars: automationTriggerText.length }]
          : []),
        ...(automationDigestText
          ? [{ id: "automation_digest", chars: automationDigestText.length }]
          : []),
        { id: "message", chars: resolved.message.length },
      ],
      selected_tools: filteredTools.map((t) => t.id),
      execution_profile: executionProfile.id,
      execution_profile_source: executionProfile.source,
      tool_schema_top: toolSchemaTop,
      tool_schema_total_chars: toolSchemaTotalChars,
      enabled_skills: ctx.skills.map((s) => s.meta.id),
      mcp_servers: ctx.mcpServers.map((s) => s.id),
      ...(automation
        ? {
            automation: {
              schedule_kind: automation.schedule_kind,
              schedule_id: automation.schedule_id,
              delivery_mode: automation.delivery_mode,
            },
          }
        : {}),
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
        tenantId: session.tenant_id,
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
      ...(automationTriggerText
        ? [
            {
              type: "text" as const,
              text: automationTriggerText,
            },
          ]
        : []),
      ...(automationDigestText
        ? [
            {
              type: "text" as const,
              text: automationDigestText,
            },
          ]
        : []),
      {
        type: "text",
        text: resolved.message,
      },
    ];

    const model = await this.resolveSessionModel({
      config: ctx.config,
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      executionProfileId: executionProfile.id,
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
      const scopeIds = await this.opts.container.identityScopeDal.resolveScopeIds({
        agentKey: this.agentId,
        workspaceKey: this.workspaceId,
      });
      const scope: WorkScope = {
        tenant_id: scopeIds.tenantId,
        agent_id: scopeIds.agentId,
        workspace_id: scopeIds.workspaceId,
      };
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
      // Intentional: intake override lookup is best-effort; fall back to default inline.
    }

    return { mode: "inline", reason_code: "default_inline" };
  }

  private async delegateFromIntake(input: {
    executionProfile: ResolvedExecutionProfile;
    mode: "delegate_execute" | "delegate_plan";
    reason_code: string;
    resolved: ResolvedAgentTurnInput;
    scope: WorkScope;
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

    const scope = input.scope;

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
    const sessionKey = (() => {
      if (!input.createdFromSessionKey.startsWith("agent:")) {
        return `agent:${this.agentId}:subagent:${subagentId}`;
      }
      const agentKey = input.createdFromSessionKey.split(":")[1]?.trim();
      const normalized = agentKey && agentKey.length > 0 ? agentKey : this.agentId;
      return `agent:${normalized}:subagent:${subagentId}`;
    })();
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
}
