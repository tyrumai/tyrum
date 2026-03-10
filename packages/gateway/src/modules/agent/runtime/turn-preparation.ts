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
  buildRuntimePrompt,
  resolveIdentityAndContext,
  resolveToolsAndMemory,
} from "./turn-preparation-runtime.js";
import { buildWorkFocusDigest } from "./work-focus-digest.js";
import type { AgentContextReport, AgentLoadedContext, AgentRuntimeOptions } from "./types.js";
import { resolveAutomationMetadata, buildAutomationDigest } from "./automation-delivery.js";
import { resolveExecutionProfile, type ResolvedExecutionProfile } from "./intake-delegation.js";
import type { AgentContextStore } from "../context-store.js";
import type { SessionRow } from "../session-dal.js";
import { SessionDal } from "../session-dal.js";
import { McpManager } from "../mcp-manager.js";
import { NodeDispatchService } from "../node-dispatch-service.js";
import { ToolExecutor } from "../tool-executor.js";
import { NodeCapabilityInspectionService } from "../../node/capability-inspection-service.js";
import { NodeInventoryService } from "../../node/inventory-service.js";
import { resolveSandboxHardeningProfile } from "../../sandbox/hardening.js";
import { LaneQueueSignalDal } from "../../lanes/queue-signal-dal.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
import type { SecretProvider } from "../../secret/provider.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "../../policy/service.js";
import type { ApprovalNotifier } from "../../approval/notifier.js";
import type { ApprovalDal } from "../../approval/dal.js";
import { buildContextReport } from "./turn-context-report.js";
import { AgentMemoryToolRuntime } from "../../memory/agent-tool-runtime.js";
import { createMemoryV1BudgetsProvider } from "../../memory/v1-budgets-provider.js";
import { resolveEmbeddingPipeline } from "./embedding-pipeline-resolution.js";
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
  userContent: Array<{ type: "text"; text: string }>;
  contextReport: AgentContextReport;
  systemPrompt: string;
  resolved: ResolvedAgentTurnInput;
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
  approvalNotifier: ApprovalNotifier;
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
  const resolved = resolveAgentTurnInput(input);
  const automation = resolveAutomationMetadata(resolved.metadata);
  const laneQueueScope = resolveLaneQueueScope(resolved.metadata);

  const { agentKey, workspaceKey, ctx, containerKind, connectorKey, accountKey } =
    await resolveIdentityAndContext(deps, input, resolved);

  const session = await deps.sessionDal.getOrCreate({
    tenantId: deps.tenantId,
    scopeKeys: { agentKey, workspaceKey },
    connectorKey,
    accountKey,
    providerThreadId: resolved.thread_id,
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
    resolved,
    containerKind,
    deliveryAccount: resolved.envelope?.delivery.account,
  });

  const executionProfile = await resolveExecutionProfile(
    {
      container: deps.opts.container,
      agentId: deps.agentId,
      workspaceId: deps.workspaceId,
    },
    { laneQueueScope, metadata: resolved.metadata },
  );

  const { memoryDigestResult, toolSetBuilder, filteredTools } = await resolveToolsAndMemory(
    deps,
    ctx,
    session,
    resolved,
    executionProfile,
  );

  const workFocusDigest =
    isStatusQuery(resolved.message) || parseIntakeModeDecision(resolved.message)
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
  const hardeningProfile = resolveSandboxHardeningProfile(
    deps.opts.container.deploymentConfig.toolrunner.hardeningProfile,
  );
  const runtimePrompt = await buildRuntimePrompt({
    nowIso: new Date().toISOString(),
    agentId: session.agent_id,
    workspaceId: session.workspace_id,
    sessionId: session.session_id,
    channel: resolved.channel,
    threadId: resolved.thread_id,
    home: deps.home,
    stateMode: resolveGatewayStateMode(deps.opts.container.deploymentConfig),
    model: executionProfile.profile.model_id ?? executionProfile.id,
    approvalWorkflowAvailable: true,
  });

  const {
    identityPrompt,
    runtimePrompt: runtimePromptText,
    safetyPrompt,
    skillsText,
    toolsText,
    sessionText,
    memoryText,
    automationTriggerText,
  } = assemblePrompts(ctx, session, memoryDigestResult, filteredTools, automation, runtimePrompt);

  const sandboxPrompt = await buildSandboxPrompt({
    policyService: deps.policyService,
    hardeningProfile,
    tenantId: deps.tenantId,
    agentId: session.agent_id,
  });
  const systemPrompt = `${identityPrompt}\n\n${runtimePromptText}\n\n${safetyPrompt}\n\n${sandboxPrompt}`;

  const automationDigestText = automation
    ? await buildAutomationDigest({
        container: deps.opts.container,
        scope: {
          tenant_id: session.tenant_id,
          agent_id: session.agent_id,
          workspace_id: session.workspace_id,
        },
        automation,
      })
    : undefined;

  const validatedReport = buildContextReport({
    session,
    resolved,
    ctx,
    executionProfile,
    filteredTools,
    systemPrompt,
    identityPrompt,
    safetyPrompt,
    sandboxPrompt,
    skillsText,
    toolsText,
    sessionText,
    workFocusText,
    memoryText,
    automationTriggerText,
    automationDigestText,
    memoryDigestResult,
    automation,
    logger: deps.opts.container.logger,
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
  const memoryToolRuntime = ctx.config.memory.v1.enabled
    ? new AgentMemoryToolRuntime({
        db: deps.opts.container.db,
        dal: deps.opts.container.memoryV1Dal,
        tenantId: session.tenant_id,
        agentId: session.agent_id,
        sessionId: session.session_id,
        channel: resolved.channel,
        threadId: resolved.thread_id,
        config: ctx.config.memory.v1,
        budgetsProvider: async () =>
          await createMemoryV1BudgetsProvider(deps.opts.container.db)(
            session.tenant_id,
            session.agent_id,
          ),
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
  );

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
    },
    validatedReport,
    laneQueue,
    toolCallPolicyStates,
    model,
  );

  const userContent: Array<{ type: "text"; text: string }> = [
    { type: "text", text: skillsText },
    { type: "text", text: toolsText },
    { type: "text", text: sessionText },
    { type: "text", text: workFocusText },
    { type: "text", text: memoryText },
    ...(automationTriggerText ? [{ type: "text" as const, text: automationTriggerText }] : []),
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
    userContent,
    contextReport: validatedReport,
    systemPrompt,
    resolved,
  };
}
