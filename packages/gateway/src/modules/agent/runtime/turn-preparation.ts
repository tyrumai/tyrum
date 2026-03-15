import { randomUUID } from "node:crypto";
import type { LanguageModel, ToolSet } from "ai";
import type { AgentTurnRequest as AgentTurnRequestT } from "@tyrum/schemas";
import type { LaneQueueState } from "./turn-engine-bridge.js";
import type { ToolCallPolicyState } from "./tool-set-builder.js";
import {
  buildSandboxPrompt,
  isStatusQuery,
  parseIntakeModeDecision,
  resolveAgentTurnInput,
  resolveLaneQueueScope,
  resolveMainLaneSessionKey,
  type ResolvedAgentTurnInput,
} from "./turn-helpers.js";
import { resolveSessionModelDetailed as resolveSessionModelImpl } from "./session-model-resolution.js";
import type { ResolvedSessionModel } from "./session-model-resolution.js";
import {
  assemblePrompts,
  buildToolSetBuilderDeps,
  buildRuntimePrompt,
  resolveIdentityAndContext,
  resolveToolsAndMemory,
} from "./turn-preparation-runtime.js";
import { runPreTurnHydration } from "./preturn-hydration.js";
import { buildWorkFocusDigest } from "./work-focus-digest.js";
import type { AgentContextReport, AgentLoadedContext, AgentRuntimeOptions } from "./types.js";
import { resolveAutomationMetadata, buildAutomationDigest } from "./automation-delivery.js";
import { resolveExecutionProfile, type ResolvedExecutionProfile } from "./intake-delegation.js";
import { ToolSetBuilder } from "./tool-set-builder.js";
import type { AgentContextStore } from "../context-store.js";
import type { SessionRow } from "../session-dal.js";
import { SessionDal } from "../session-dal.js";
import { McpManager } from "../mcp-manager.js";
import { NodeDispatchService } from "../node-dispatch-service.js";
import { ToolExecutor } from "../tool-executor.js";
import { NodeCapabilityInspectionService } from "../../node/capability-inspection-service.js";
import { NodeInventoryService } from "../../node/inventory-service.js";
import { LaneQueueSignalDal } from "../../lanes/queue-signal-dal.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
import type { SecretProvider } from "../../secret/provider.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "../../policy/service.js";
import type { ApprovalDal } from "../../approval/dal.js";
import { buildContextReport } from "./turn-context-report.js";
import { AgentMemoryToolRuntime } from "../../memory/agent-tool-runtime.js";
import { resolveBuiltinMemoryConfig } from "../../memory/builtin-mcp.js";
import { resolveEmbeddingPipeline } from "./embedding-pipeline-resolution.js";
import {
  buildGuardianReviewSystemPrompt,
  createGuardianReviewDecisionCollector,
  resolveGuardianReviewRequest,
  type GuardianReviewDecisionCollector,
} from "../../review/guardian-review-mode.js";

export type TurnExecutionContext = {
  planId: string;
  runId: string;
  stepIndex: number;
  stepId: string;
  stepApprovalId?: string;
};

export type PreparedTurn = {
  ctx: AgentLoadedContext;
  executionProfile: ResolvedExecutionProfile;
  session: SessionRow;
  mainLaneSessionKey: string;
  model: LanguageModel;
  modelResolution: ResolvedSessionModel;
  toolSet: ToolSet;
  toolCallPolicyStates: Map<string, ToolCallPolicyState>;
  laneQueue?: LaneQueueState;
  usedTools: Set<string>;
  memoryWriteState: { wrote: boolean };
  userContent: Array<{ type: "text"; text: string }>;
  contextReport: AgentContextReport;
  systemPrompt: string;
  resolved: ResolvedAgentTurnInput;
  guardianReviewDecisionCollector?: GuardianReviewDecisionCollector;
};

export type PrepareTurnDeps = {
  opts: AgentRuntimeOptions;
  home: string;
  contextStore: AgentContextStore;
  sessionDal: SessionDal;
  fetchImpl: typeof fetch;
  tenantId: string;
  agentId: string;
  workspaceId: string;
  instanceOwner: string;
  languageModelOverride?: LanguageModel;
  mcpManager: McpManager;
  plugins: PluginRegistry | undefined;
  policyService: PolicyService;
  approvalDal: ApprovalDal;
  approvalWaitMs: number;
  approvalPollMs: number;
  secretProvider: SecretProvider | undefined;
  defaultHeartbeatSeededScopes: Set<string>;
  cleanupAtMs: number;
  setCleanupAtMs: (ms: number) => void;
};

export async function prepareTurn(
  deps: PrepareTurnDeps,
  input: AgentTurnRequestT,
  exec?: TurnExecutionContext,
): Promise<PreparedTurn> {
  const resolvedInput = resolveAgentTurnInput(input);
  const automation = resolveAutomationMetadata(resolvedInput.metadata);
  const laneQueueScope = resolveLaneQueueScope(resolvedInput.metadata);

  const { agentKey, workspaceKey, ctx, containerKind, connectorKey, accountKey } =
    await resolveIdentityAndContext(deps, input, resolvedInput);

  const session = await deps.sessionDal.getOrCreate({
    tenantId: deps.tenantId,
    scopeKeys: { agentKey, workspaceKey },
    connectorKey,
    accountKey,
    providerThreadId: resolvedInput.thread_id,
    containerKind,
  });

  const laneQueue: LaneQueueState | undefined = laneQueueScope
    ? {
        tenant_id: session.tenant_id,
        scope: laneQueueScope,
        signals: new LaneQueueSignalDal(deps.opts.container.db),
        interruptError: undefined,
        cancelToolCalls: false,
        pendingInjectionTexts: [],
      }
    : undefined;

  const mainLaneSessionKey = resolveMainLaneSessionKey({
    agentId: agentKey,
    workspaceId: workspaceKey,
    resolved: resolvedInput,
    containerKind,
    deliveryAccount: resolvedInput.envelope?.delivery.account,
  });
  const resolved: ResolvedAgentTurnInput = {
    ...resolvedInput,
    metadata: {
      ...resolvedInput.metadata,
      work_session_key:
        typeof resolvedInput.metadata?.["work_session_key"] === "string"
          ? resolvedInput.metadata["work_session_key"]
          : mainLaneSessionKey,
      work_lane:
        typeof resolvedInput.metadata?.["work_lane"] === "string"
          ? resolvedInput.metadata["work_lane"]
          : "main",
    },
  };

  const executionProfile = await resolveExecutionProfile(
    {
      container: deps.opts.container,
      agentId: deps.agentId,
      workspaceId: deps.workspaceId,
    },
    { laneQueueScope, metadata: resolved.metadata },
  );

  const guardianReviewRequest = resolveGuardianReviewRequest(resolved.metadata);
  const guardianReviewToolSetBuilder = guardianReviewRequest
    ? new ToolSetBuilder(buildToolSetBuilderDeps(deps, session, executionProfile.profile))
    : undefined;
  const normalTurnContext = guardianReviewRequest
    ? undefined
    : await resolveToolsAndMemory(deps, ctx, session, resolved, executionProfile);
  const availableTools = normalTurnContext?.availableTools ?? [];
  const toolSetBuilderDeps = normalTurnContext?.toolSetBuilderDeps;
  const filteredTools = normalTurnContext?.filteredTools ?? [];
  const resolvedToolSetBuilder = normalTurnContext?.toolSetBuilder ?? guardianReviewToolSetBuilder;
  if (!resolvedToolSetBuilder) {
    throw new Error("tool set builder unavailable for turn preparation");
  }

  const workFocusDigest = guardianReviewRequest
    ? "Skipped in guardian review mode."
    : isStatusQuery(resolved.message) || parseIntakeModeDecision(resolved.message)
      ? "Skipped for command turns."
      : await buildWorkFocusDigest({
          container: deps.opts.container,
          scope: {
            tenant_id: session.tenant_id,
            agent_id: session.agent_id,
            workspace_id: session.workspace_id,
          },
        });
  const workFocusText = `Work focus digest:\n${workFocusDigest}`;
  const runtimePrompt = guardianReviewRequest
    ? undefined
    : await buildRuntimePrompt({
        nowIso: new Date().toISOString(),
        agentId: session.agent_id,
        workspaceId: session.workspace_id,
        sessionId: session.session_id,
        channel: resolved.channel,
        threadId: resolved.thread_id,
        home: deps.home,
        stateMode: resolveGatewayStateMode(deps.opts.container.deploymentConfig),
        model: executionProfile.profile.model_id ?? executionProfile.id,
      });

  const mcpSpecMap = new Map<string, (typeof ctx.mcpServers)[number]>(
    ctx.mcpServers.map((server: (typeof ctx.mcpServers)[number]) => [server.id, server]),
  );
  const nodeDispatchService = deps.opts.protocolDeps
    ? new NodeDispatchService(deps.opts.protocolDeps)
    : undefined;
  const nodeInventoryService = deps.opts.protocolDeps
    ? new NodeInventoryService({
        connectionManager: deps.opts.protocolDeps.connectionManager,
        connectionDirectory: deps.opts.protocolDeps.cluster?.connectionDirectory,
        nodePairingDal: deps.opts.container.nodePairingDal,
        presenceDal: deps.opts.container.presenceDal,
        attachmentDal: deps.opts.container.sessionLaneNodeAttachmentDal,
      })
    : undefined;
  const nodeCapabilityInspectionService =
    deps.opts.protocolDeps && nodeInventoryService
      ? new NodeCapabilityInspectionService({
          connectionManager: deps.opts.protocolDeps.connectionManager,
          connectionDirectory: deps.opts.protocolDeps.cluster?.connectionDirectory,
          nodeInventoryService,
        })
      : undefined;
  const modelResolution = await resolveSessionModelImpl(
    {
      container: deps.opts.container,
      languageModelOverride: deps.languageModelOverride,
      secretProvider: deps.secretProvider,
      oauthLeaseOwner: deps.instanceOwner,
      fetchImpl: deps.fetchImpl,
    },
    {
      config: ctx.config,
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      executionProfileId: executionProfile.id,
      profileModelId: executionProfile.profile.model_id,
      fetchImpl: deps.fetchImpl,
    },
  );
  const model = modelResolution.model;
  const memoryConfig = resolveBuiltinMemoryConfig(ctx.config);
  const memoryToolRuntime = memoryConfig.enabled
    ? new AgentMemoryToolRuntime({
        db: deps.opts.container.db,
        dal: deps.opts.container.memoryV1Dal,
        tenantId: session.tenant_id,
        agentId: session.agent_id,
        sessionId: session.session_id,
        channel: resolved.channel,
        threadId: resolved.thread_id,
        config: memoryConfig,
        budgetsProvider: async () => memoryConfig.budgets,
        resolveEmbeddingPipeline: async () =>
          await resolveEmbeddingPipeline({
            container: deps.opts.container,
            secretProvider: deps.secretProvider,
            instanceOwner: deps.instanceOwner,
            fetchImpl: deps.fetchImpl,
            primaryModelId: executionProfile.profile.model_id ?? ctx.config.model.model,
            sessionId: session.session_id,
            tenantId: session.tenant_id,
            agentId: session.agent_id,
          }),
      })
    : undefined;
  const toolExecutor = new ToolExecutor(
    deps.home,
    deps.mcpManager,
    mcpSpecMap,
    deps.fetchImpl,
    deps.secretProvider,
    undefined,
    deps.opts.container.redactionEngine,
    deps.opts.container.secretResolutionAuditDal,
    {
      db: deps.opts.container.db,
      tenantId: session.tenant_id,
      agentId: session.agent_id,
      workspaceId: session.workspace_id,
      ownerPrefix: deps.instanceOwner,
    },
    nodeDispatchService,
    deps.opts.container.artifactStore,
    deps.opts.container.identityScopeDal,
    nodeInventoryService,
    nodeCapabilityInspectionService,
    memoryToolRuntime,
    deps.opts.protocolDeps?.agents,
    deps.opts.protocolDeps,
  );
  const toolExecutionContext = {
    tenantId: session.tenant_id,
    planId: exec?.planId ?? `agent-turn-${session.session_id}-${randomUUID()}`,
    sessionId: session.session_id,
    channel: resolved.channel,
    threadId: resolved.thread_id,
    workSessionKey:
      typeof resolved.metadata?.["work_session_key"] === "string"
        ? resolved.metadata["work_session_key"]
        : undefined,
    workLane:
      typeof resolved.metadata?.["work_lane"] === "string"
        ? resolved.metadata["work_lane"]
        : undefined,
    execution: exec
      ? {
          runId: exec.runId,
          stepIndex: exec.stepIndex,
          stepId: exec.stepId,
          stepApprovalId: exec.stepApprovalId,
        }
      : undefined,
  };
  const preTurnHydration =
    guardianReviewRequest ||
    isStatusQuery(resolved.message) ||
    parseIntakeModeDecision(resolved.message) ||
    ctx.config.mcp.pre_turn_tools.length === 0 ||
    !toolSetBuilderDeps
      ? {
          sections: [],
          reports: [],
          memory: {
            keyword_hits: 0,
            semantic_hits: 0,
            structured_hits: 0,
            included_items: 0,
          },
        }
      : await runPreTurnHydration({
          toolIds: ctx.config.mcp.pre_turn_tools,
          availableTools,
          toolExecutor,
          toolSetBuilderDeps,
          toolExecutionContext,
          session,
          resolved,
        });

  const sandboxPrompt = guardianReviewRequest ? "" : buildSandboxPrompt();
  const guardianReviewDecisionCollector = guardianReviewRequest
    ? createGuardianReviewDecisionCollector(guardianReviewRequest.subjectType)
    : undefined;

  const promptParts = guardianReviewRequest
    ? {
        identityPrompt: "",
        runtimePromptText: "",
        safetyPrompt: "",
        skillsText: "Enabled skills:\nGuardian review mode disabled skills.",
        toolsText: "Available tools:\nguardian_review_decision",
        sessionText:
          "Session context:\nGuardian review mode relies on the supplied review request evidence.",
        preTurnTexts: [] as string[],
        automationTriggerText: undefined as string | undefined,
      }
    : (() => {
        const assembled = assemblePrompts(
          ctx,
          session,
          filteredTools,
          preTurnHydration.sections.map((section) => section.text),
          automation,
          runtimePrompt ?? "",
        );
        return {
          identityPrompt: assembled.identityPrompt,
          runtimePromptText: assembled.runtimePrompt,
          safetyPrompt: assembled.safetyPrompt,
          skillsText: assembled.skillsText,
          toolsText: assembled.toolsText,
          sessionText: assembled.sessionText,
          preTurnTexts: assembled.preTurnTexts,
          automationTriggerText: assembled.automationTriggerText,
        };
      })();

  const systemPrompt = guardianReviewRequest
    ? buildGuardianReviewSystemPrompt(guardianReviewRequest.subjectType)
    : [
        promptParts.identityPrompt,
        promptParts.runtimePromptText,
        promptParts.safetyPrompt,
        sandboxPrompt,
      ]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join("\n\n");

  const automationDigestText =
    guardianReviewRequest || !automation
      ? undefined
      : await buildAutomationDigest({
          container: deps.opts.container,
          scope: {
            tenant_id: session.tenant_id,
            agent_id: session.agent_id,
            workspace_id: session.workspace_id,
          },
          automation,
        });

  const validatedReport = buildContextReport({
    session,
    resolved,
    ctx,
    executionProfile,
    filteredTools,
    systemPrompt,
    identityPrompt: promptParts.identityPrompt,
    safetyPrompt: promptParts.safetyPrompt,
    sandboxPrompt,
    skillsText: promptParts.skillsText,
    toolsText: promptParts.toolsText,
    sessionText: promptParts.sessionText,
    workFocusText,
    preTurnTexts: [...promptParts.preTurnTexts],
    preTurnReports: preTurnHydration.reports,
    automationTriggerText: promptParts.automationTriggerText,
    automationDigestText,
    memorySummary: preTurnHydration.memory,
    automation,
    logger: deps.opts.container.logger,
  });

  const usedTools = new Set<string>();
  const memoryWriteState = { wrote: false };
  const toolCallPolicyStates = new Map<string, ToolCallPolicyState>();
  const toolSet = resolvedToolSetBuilder.buildToolSet(
    filteredTools,
    toolExecutor,
    usedTools,
    toolExecutionContext,
    validatedReport,
    laneQueue,
    toolCallPolicyStates,
    model,
    memoryWriteState,
    guardianReviewDecisionCollector,
  );

  const userContent: Array<{ type: "text"; text: string }> = guardianReviewRequest
    ? [{ type: "text", text: resolved.message }]
    : [
        { type: "text", text: promptParts.skillsText },
        { type: "text", text: promptParts.toolsText },
        { type: "text", text: promptParts.sessionText },
        { type: "text", text: workFocusText },
        ...promptParts.preTurnTexts.map((text) => ({ type: "text" as const, text })),
        ...(promptParts.automationTriggerText
          ? [{ type: "text" as const, text: promptParts.automationTriggerText }]
          : []),
        ...(automationDigestText ? [{ type: "text" as const, text: automationDigestText }] : []),
        { type: "text", text: resolved.message },
      ];

  return {
    ctx,
    executionProfile,
    session,
    mainLaneSessionKey,
    model,
    modelResolution,
    toolSet,
    toolCallPolicyStates,
    laneQueue,
    usedTools,
    memoryWriteState,
    userContent,
    contextReport: validatedReport,
    systemPrompt,
    resolved,
    guardianReviewDecisionCollector,
  };
}
