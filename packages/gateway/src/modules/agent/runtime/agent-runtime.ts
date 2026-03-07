import { randomUUID } from "node:crypto";
import { generateText, stepCountIs, streamText } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import type {
  AgentStatusResponse as AgentStatusResponseT,
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
  SecretHandle as SecretHandleT,
  WorkScope,
} from "@tyrum/schemas";
import {
  AgentKey,
  AgentStatusResponse,
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
import type { ToolCallPolicyState } from "./tool-set-builder.js";
import {
  ToolExecutionApprovalRequiredError,
  createStaticLanguageModelV3,
  extractToolApprovalResumeState,
  isStatusQuery,
  resolveAgentId,
  resolveAgentTurnInput,
  resolveLaneQueueScope,
  type ResolvedAgentTurnInput,
  resolveTurnRequestId,
  type StepPauseRequest,
} from "./turn-helpers.js";
import { finalizeTurn } from "./turn-finalization.js";
import type { AgentContextReport, AgentRuntimeOptions } from "./types.js";
import { resolveTyrumHome } from "../home.js";
import { detectWithinTurnToolLoop } from "../loop-detection.js";
import { SessionDal, type SessionRow } from "../session-dal.js";
import { AgentConfigDal } from "../../config/agent-config-dal.js";
import { McpManager } from "../mcp-manager.js";
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
import { resolveWorkspaceKey } from "../../workspace/id.js";
import { DEFAULT_TENANT_ID } from "../../identity/scope.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
import {
  resolveAutomationMetadata,
  maybeDeliverAutomationReply,
} from "./automation-delivery.js";
import {
  resolveExecutionProfile,
  resolveIntakeDecision,
  delegateFromIntake,
  handleIntakeModeDecision,
} from "./intake-delegation.js";
import {
  prepareTurn,
  type TurnExecutionContext,
  type PrepareTurnDeps,
} from "./turn-preparation.js";

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

const NOOP_APPROVAL_NOTIFIER: ApprovalNotifier = {
  notify(_approval) {
    // no-op
  },
};

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

  private get prepareTurnDeps(): PrepareTurnDeps {
    return {
      opts: this.opts,
      home: this.home,
      contextStore: this.contextStore,
      sessionDal: this.sessionDal,
      fetchImpl: this.fetchImpl,
      tenantId: this.tenantId,
      agentId: this.agentId,
      workspaceId: this.workspaceId,
      instanceOwner: this.instanceOwner,
      languageModelOverride: this.languageModelOverride,
      mcpManager: this.mcpManager,
      plugins: this.plugins,
      policyService: this.policyService,
      approvalDal: this.approvalDal,
      approvalNotifier: this.approvalNotifier,
      approvalWaitMs: this.approvalWaitMs,
      approvalPollMs: this.approvalPollMs,
      secretProvider: this.opts.secretProvider,
      defaultHeartbeatSeededScopes: this.defaultHeartbeatSeededScopes,
      cleanupAtMs: this.cleanupAtMs,
      setCleanupAtMs: (ms: number) => {
        this.cleanupAtMs = ms;
      },
    };
  }

  async status(enabled: boolean): Promise<AgentStatusResponseT> {
    if (!enabled) {
      return AgentStatusResponse.parse({
        enabled: false,
        home: this.home,
        identity: { name: "disabled" },
        model: { model: "disabled/disabled" },
        skills: [],
        mcp: [],
        tools: [],
        sessions: { ttl_days: 30, max_turns: 20 },
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
    const config = await (
      await new AgentConfigDal(this.opts.container.db).ensureSeeded({
        tenantId: this.tenantId,
        agentId,
        defaultConfig: buildDefaultAgentConfig(
          resolveGatewayStateMode(this.opts.container.deploymentConfig),
        ),
        createdBy: { kind: "agent-runtime" },
        reason: "seed",
      })
    ).config;
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
    contextPruning: Parameters<typeof prepareLaneQueueStepBridge>[2],
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
    const prepared = await prepareTurn(this.prepareTurnDeps, input);
    const {
      ctx, executionProfile, session, mainLaneSessionKey, model,
      toolSet, laneQueue, usedTools, userContent, contextReport, systemPrompt, resolved,
    } = prepared;

    const intake = await resolveIntakeDecision(
      { container: this.opts.container },
      { input, executionProfile, resolved, mainLaneSessionKey },
    );
    if (intake.mode === "delegate_execute" || intake.mode === "delegate_plan") {
      const delegation = await delegateFromIntake(
        { agentId: this.agentId, container: this.opts.container },
        {
          executionProfile, mode: intake.mode, reason_code: intake.reason_code, resolved,
          scope: { tenant_id: session.tenant_id, agent_id: session.agent_id, workspace_id: session.workspace_id },
          createdFromSessionKey: mainLaneSessionKey,
        },
      );
      this.lastContextReport = contextReport;
      const response = await finalizeTurn({
        container: this.opts.container, sessionDal: this.sessionDal,
        ctx, session, resolved, reply: delegation.reply, usedTools, contextReport,
      });

      const streamResult = streamText({
        model: createStaticLanguageModelV3(delegation.reply),
        system: "",
        messages: [{ role: "user" as const, content: [{ type: "text", text: "" }] }],
        stopWhen: [stepCountIs(1)],
      });

      return { streamResult, sessionId: session.session_id, finalize: async () => response };
    }

    await maybeRunPreCompactionMemoryFlush(
      { db: this.opts.container.db, logger: this.opts.container.logger, agentId: session.agent_id },
      { ctx, session, model, systemPrompt },
    );

    const withinTurnCfg = ctx.config.sessions.loop_detection.within_turn;
    const { stopWhen, withinTurnLoop } = this.createStopWhenWithWithinTurnLoopDetection({
      stepLimit: this.maxSteps, withinTurnCfg,
      sessionId: session.session_id, channel: resolved.channel, threadId: resolved.thread_id,
    });

    const streamResult = streamText({
      model, system: systemPrompt,
      messages: [{ role: "user" as const, content: userContent }],
      tools: toolSet, stopWhen,
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
        container: this.opts.container, sessionDal: this.sessionDal,
        ctx, session, resolved, reply, usedTools, contextReport,
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
      await maybeDeliverAutomationReply(
        {
          container: this.opts.container,
          tenantId: this.tenantId,
          agentId: this.agentId,
          workspaceId: this.workspaceId,
          policyService: this.policyService,
          approvalDal: this.approvalDal,
          approvalNotifier: this.approvalNotifier,
        },
        { turnInput: input, response, automation },
      );
    }
    return response;
  }

  private async maybeStoreToolApprovalArgsHandle(input: {
    toolId: string;
    toolCallId: string;
    args: unknown;
  }): Promise<SecretHandleT | undefined> {
    const secretProvider = this.opts.secretProvider;
    if (!secretProvider) return undefined;

    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(input.args);
    } catch {
      // Intentional: tool approval arg persistence is best-effort; args may be non-serializable.
      serialized = undefined;
    }
    if (typeof serialized !== "string") return undefined;

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
    const prepared = await prepareTurn(this.prepareTurnDeps, input, opts?.execution);
    const {
      ctx, executionProfile, session, mainLaneSessionKey, model,
      toolSet, toolCallPolicyStates, laneQueue, usedTools, userContent,
      contextReport, systemPrompt, resolved,
    } = prepared;

    const workScope: WorkScope = {
      tenant_id: session.tenant_id,
      agent_id: session.agent_id,
      workspace_id: session.workspace_id,
    };

    if (isStatusQuery(resolved.message)) {
      const reply = await this.handleStatusQuery(workScope);
      this.lastContextReport = contextReport;
      return await finalizeTurn({
        container: this.opts.container, sessionDal: this.sessionDal,
        ctx, session, resolved, reply, usedTools, contextReport,
      });
    }

    const intakeResult = await handleIntakeModeDecision(
      { container: this.opts.container },
      { resolved, workScope },
    );
    if (intakeResult) {
      this.lastContextReport = contextReport;
      return await finalizeTurn({
        container: this.opts.container, sessionDal: this.sessionDal,
        ctx, session, resolved, reply: intakeResult.reply, usedTools, contextReport,
      });
    }

    const intake = await resolveIntakeDecision(
      { container: this.opts.container },
      { input, executionProfile, resolved, mainLaneSessionKey },
    );
    if (intake.mode === "delegate_execute" || intake.mode === "delegate_plan") {
      const delegation = await delegateFromIntake(
        { agentId: this.agentId, container: this.opts.container },
        {
          executionProfile, mode: intake.mode, reason_code: intake.reason_code, resolved,
          scope: workScope, createdFromSessionKey: mainLaneSessionKey,
        },
      );
      this.lastContextReport = contextReport;
      return await finalizeTurn({
        container: this.opts.container, sessionDal: this.sessionDal,
        ctx, session, resolved, reply: delegation.reply, usedTools, contextReport,
      });
    }

    await maybeRunPreCompactionMemoryFlush(
      { db: this.opts.container.db, logger: this.opts.container.logger, agentId: session.agent_id },
      { ctx, session, model, systemPrompt, abortSignal, timeoutMs: opts?.timeoutMs },
    );

    let messages: ModelMessage[] = [{ role: "user" as const, content: userContent }];
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
        container: this.opts.container, sessionDal: this.sessionDal,
        ctx, session, resolved, reply, usedTools, contextReport,
      });
    }

    const withinTurnCfg = ctx.config.sessions.loop_detection.within_turn;
    const { stopWhen, withinTurnLoop } = this.createStopWhenWithWithinTurnLoopDetection({
      stepLimit: remainingSteps, withinTurnCfg,
      sessionId: session.session_id, channel: resolved.channel, threadId: resolved.thread_id,
    });

    const result = await generateText({
      model, system: systemPrompt, messages, tools: toolSet, stopWhen,
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
      await this.throwToolApprovalError(
        approvalPart, toolCallPolicyStates, session, resolved,
        usedTools, stepsUsedAfterCall, messages, result,
      );
    }

    const rawReply = result.text || "";
    const automation = resolveAutomationMetadata(resolved.metadata);
    const reply = this.resolveTurnReply(rawReply, withinTurnLoop.value, {
      allowEmpty: automation?.delivery_mode === "quiet",
    });
    this.lastContextReport = contextReport;
    return await finalizeTurn({
      container: this.opts.container, sessionDal: this.sessionDal,
      ctx, session, resolved, reply, usedTools, contextReport,
    });
  }

  private async handleStatusQuery(workScope: WorkScope): Promise<string> {
    try {
      const { WorkboardDal } = await import("../../workboard/dal.js");
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
        return "WorkBoard status: no active work items.";
      }
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
      return lines.join("\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.container.logger.warn("workboard.status_query_failed", { error: message });
      return "WorkBoard status is unavailable.";
    }
  }

  private async throwToolApprovalError(
    approvalPart: unknown,
    toolCallPolicyStates: Map<string, ToolCallPolicyState>,
    session: SessionRow,
    resolved: ResolvedAgentTurnInput,
    usedTools: Set<string>,
    stepsUsedAfterCall: number,
    messages: ModelMessage[],
    result: Awaited<ReturnType<typeof generateText>>,
  ): Promise<never> {
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

    // Store args handle synchronously-ish via a thrown error; the caller handles the async part.
    // We need to throw synchronously, so we embed args in the context directly.
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
      resolveExecutionProfile: (args: { laneQueueScope?: LaneQueueScope; metadata?: Record<string, unknown> }) =>
        resolveExecutionProfile(
          { container: this.opts.container, agentId: this.agentId, workspaceId: this.workspaceId },
          args,
        ),
      turnDirect: (request: AgentTurnRequestT, turnOpts?: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: TurnExecutionContext }) =>
        this.turnDirect(request, turnOpts),
      resolveAgentTurnInput,
      resolveLaneQueueScope,
      resolveTurnRequestId,
      isToolExecutionApprovalRequiredError: (err: unknown): err is { pause: StepPauseRequest } =>
        err instanceof ToolExecutionApprovalRequiredError,
    } satisfies TurnEngineBridgeDeps;

    return await turnViaExecutionEngineBridge(deps, input);
  }
}
