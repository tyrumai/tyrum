import { randomUUID } from "node:crypto";
import type { LanguageModel, ToolSet } from "ai";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  NormalizedContainerKind,
} from "@tyrum/schemas";
import type { LaneQueueState } from "./turn-engine-bridge.js";
import type { ToolCallPolicyState } from "./tool-set-builder.js";
import { ToolSetBuilder } from "./tool-set-builder.js";
import {
  buildSandboxPrompt,
  isStatusQuery,
  parseIntakeModeDecision,
  resolveAgentTurnInput,
  resolveLaneQueueScope,
  resolveMainLaneSessionKey,
  type ResolvedAgentTurnInput,
} from "./turn-helpers.js";
import {
  DATA_TAG_SAFETY_PROMPT,
  formatIdentityPrompt,
  formatSessionContext,
  formatSkillsPrompt,
  formatToolPrompt,
} from "./prompts.js";
import {
  resolveSessionModelDetailed as resolveSessionModelImpl,
  type ResolvedSessionModel,
} from "./session-model-resolution.js";
import {
  semanticSearch,
  ensureDefaultHeartbeatSchedule,
  maybeCleanupSessions,
  loadAgentConfigFromDb,
} from "./turn-preparation-helpers.js";
import { buildWorkFocusDigest } from "./work-focus-digest.js";
import type { AgentContextReport, AgentLoadedContext, AgentRuntimeOptions } from "./types.js";
import { resolveAutomationMetadata, buildAutomationDigest } from "./automation-delivery.js";
import { resolveExecutionProfile, type ResolvedExecutionProfile } from "./intake-delegation.js";
import type { AgentContextStore } from "../context-store.js";
import { loadCurrentAgentContext } from "../load-context.js";
import type { SessionRow } from "../session-dal.js";
import { SessionDal } from "../session-dal.js";
import { isToolAllowed, selectToolDirectory } from "../tools.js";
import { parseChannelSourceKey } from "../../channels/interface.js";
import { tagContent } from "../provenance.js";
import { sanitizeForModel } from "../sanitizer.js";
import { MemoryV1Dal } from "../../memory/v1-dal.js";
import { buildMemoryV1Digest } from "../../memory/v1-digest.js";
import { McpManager } from "../mcp-manager.js";
import { NodeDispatchService } from "../node-dispatch-service.js";
import { ToolExecutor } from "../tool-executor.js";
import { resolveSandboxHardeningProfile } from "../../sandbox/hardening.js";
import { LaneQueueSignalDal } from "../../lanes/queue-signal-dal.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
import type { SecretProvider } from "../../secret/provider.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "../../policy/service.js";
import type { ApprovalNotifier } from "../../approval/notifier.js";
import type { ApprovalDal } from "../../approval/dal.js";
import { buildContextReport } from "./turn-context-report.js";
import { applyPersonaToIdentity, resolveAgentPersona } from "../persona.js";

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

async function resolveIdentityAndContext(
  deps: PrepareTurnDeps,
  input: AgentTurnRequestT,
  resolved: ResolvedAgentTurnInput,
) {
  const agentKey = input.agent_key?.trim() || deps.agentId;
  const workspaceKey = input.workspace_key?.trim() || deps.workspaceId;

  const agentId = await deps.opts.container.identityScopeDal.ensureAgentId(deps.tenantId, agentKey);
  const workspaceId = await deps.opts.container.identityScopeDal.ensureWorkspaceId(
    deps.tenantId,
    workspaceKey,
  );
  await deps.opts.container.identityScopeDal.ensureMembership(deps.tenantId, agentId, workspaceId);
  await ensureDefaultHeartbeatSchedule(deps, agentId, workspaceId);

  const config = await loadAgentConfigFromDb(deps, {
    tenantId: deps.tenantId,
    agentId,
    agentKey,
  });
  const loaded = await loadCurrentAgentContext({
    contextStore: deps.contextStore,
    tenantId: deps.tenantId,
    agentId,
    workspaceId,
    config,
  });
  const persona = resolveAgentPersona({
    agentKey,
    config: loaded.config,
    identity: loaded.identity,
  });
  const ctx = {
    ...loaded,
    identity: applyPersonaToIdentity(loaded.identity, persona),
  };
  maybeCleanupSessions(deps, ctx.config.sessions.ttl_days, agentKey);

  const containerKind: NormalizedContainerKind =
    input.container_kind ?? resolved.envelope?.container.kind ?? "channel";

  const parsedChannel = parseChannelSourceKey(resolved.channel);
  const connectorKey = parsedChannel.connector;
  const accountKey = resolved.envelope?.delivery.account ?? parsedChannel.accountId;

  return { agentKey, workspaceKey, ctx, containerKind, connectorKey, accountKey };
}

async function resolveToolsAndMemory(
  deps: PrepareTurnDeps,
  ctx: AgentLoadedContext,
  session: SessionRow,
  resolved: ResolvedAgentTurnInput,
  executionProfile: ResolvedExecutionProfile,
) {
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
              dal: new MemoryV1Dal(deps.opts.container.db),
              tenantId: session.tenant_id,
              agentId: session.agent_id,
              query: resolved.message,
              config: ctx.config.memory.v1,
              semanticSearch: ctx.config.memory.v1.semantic.enabled
                ? (query, limit) =>
                    semanticSearch(
                      deps,
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
            deps.opts.container.logger.warn("memory.v1.digest_failed", {
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
      ? deps.mcpManager.listToolDescriptors(ctx.mcpServers)
      : deps.mcpManager.listToolDescriptors([]),
  ]);
  const pluginToolsRaw = deps.plugins?.getToolDescriptors() ?? [];
  const toolSetBuilder = new ToolSetBuilder({
    home: deps.home,
    stateMode: resolveGatewayStateMode(deps.opts.container.deploymentConfig),
    tenantId: session.tenant_id,
    agentId: session.agent_id,
    workspaceId: session.workspace_id,
    policyService: deps.policyService,
    approvalDal: deps.opts.container.approvalDal,
    approvalNotifier: deps.approvalNotifier as { notify: (approval: unknown) => void },
    approvalWaitMs: deps.approvalWaitMs,
    approvalPollMs: deps.approvalPollMs,
    logger: deps.opts.container.logger,
    secretProvider: deps.secretProvider,
    plugins: deps.plugins,
    redactionEngine: deps.opts.container.redactionEngine,
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
    resolveGatewayStateMode(deps.opts.container.deploymentConfig),
  );
  const filteredTools = toolCandidates
    .filter((tool) => isToolAllowed(executionProfile.profile.tool_allowlist, tool.id))
    .slice(0, 8);

  return { memoryDigestResult, toolSetBuilder, filteredTools };
}

function assemblePrompts(
  ctx: AgentLoadedContext,
  session: SessionRow,
  memoryDigestResult: { digest: string },
  filteredTools: ReturnType<typeof selectToolDirectory>,
  automation: ReturnType<typeof resolveAutomationMetadata>,
) {
  const sessionCtx = formatSessionContext(session.summary, session.turns);
  const identityPrompt = formatIdentityPrompt(ctx.identity);
  const safetyPrompt = DATA_TAG_SAFETY_PROMPT;
  const skillsText = `Enabled skills:\n${formatSkillsPrompt(ctx.skills)}`;
  const toolsText = `Available tools:\n${formatToolPrompt(filteredTools)}`;
  const sessionText = `Session context:\n${sessionCtx}`;
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

  return {
    identityPrompt,
    safetyPrompt,
    skillsText,
    toolsText,
    sessionText,
    memoryText,
    automationTriggerText,
  };
}

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

  const {
    identityPrompt,
    safetyPrompt,
    skillsText,
    toolsText,
    sessionText,
    memoryText,
    automationTriggerText,
  } = assemblePrompts(ctx, session, memoryDigestResult, filteredTools, automation);

  const hardeningProfile = resolveSandboxHardeningProfile(
    deps.opts.container.deploymentConfig.toolrunner.hardeningProfile,
  );
  const sandboxPrompt = await buildSandboxPrompt({
    policyService: deps.policyService,
    hardeningProfile,
    tenantId: deps.tenantId,
    agentId: session.agent_id,
  });
  const systemPrompt = `${identityPrompt}\n\n${safetyPrompt}\n\n${sandboxPrompt}`;

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

  const mcpSpecMap = new Map(ctx.mcpServers.map((server) => [server.id, server]));
  const nodeDispatchService = deps.opts.protocolDeps
    ? new NodeDispatchService(deps.opts.protocolDeps)
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
