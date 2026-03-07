import { randomUUID } from "node:crypto";
import type { LanguageModel, ToolSet } from "ai";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentConfig as AgentConfigT,
  NormalizedContainerKind,
} from "@tyrum/schemas";
import { ContextReport as ContextReportSchema } from "@tyrum/schemas";
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
import { resolveSessionModel as resolveSessionModelImpl } from "./session-model-resolution.js";
import { resolveEmbeddingPipeline } from "./embedding-pipeline-resolution.js";
import { buildWorkFocusDigest } from "./work-focus-digest.js";
import type { AgentContextReport, AgentLoadedContext, AgentRuntimeOptions } from "./types.js";
import { resolveAutomationMetadata, buildAutomationDigest } from "./automation-delivery.js";
import { resolveExecutionProfile, type ResolvedExecutionProfile } from "./intake-delegation.js";
import { buildDefaultAgentConfig } from "../default-config.js";
import type { AgentContextStore } from "../context-store.js";
import { loadCurrentAgentContext } from "../load-context.js";
import type { SessionRow } from "../session-dal.js";
import { SessionDal } from "../session-dal.js";
import { AgentConfigDal } from "../../config/agent-config-dal.js";
import { isToolAllowed, selectToolDirectory } from "../tools.js";
import { parseChannelSourceKey } from "../../channels/interface.js";
import { tagContent } from "../provenance.js";
import { sanitizeForModel } from "../sanitizer.js";
import { MemoryV1Dal } from "../../memory/v1-dal.js";
import { buildMemoryV1Digest } from "../../memory/v1-digest.js";
import {
  MemoryV1SemanticIndex,
  type MemoryV1SemanticSearchHit,
} from "../../memory/v1-semantic-index.js";
import { McpManager } from "../mcp-manager.js";
import { NodeDispatchService } from "../node-dispatch-service.js";
import { ToolExecutor } from "../tool-executor.js";
import { resolveSandboxHardeningProfile } from "../../sandbox/hardening.js";
import { LaneQueueSignalDal } from "../../lanes/queue-signal-dal.js";
import { ScheduleService } from "../../automation/schedule-service.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
import type { SecretProvider } from "../../secret/provider.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "../../policy/service.js";
import type { ApprovalNotifier } from "../../approval/notifier.js";
import type { ApprovalDal } from "../../approval/dal.js";

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

async function semanticSearch(
  deps: PrepareTurnDeps,
  query: string,
  limit: number,
  primaryModelId: string,
  sessionId: string,
  tenantId: string,
  agentId: string,
): Promise<MemoryV1SemanticSearchHit[]> {
  try {
    const pipeline = await resolveEmbeddingPipeline({
      container: deps.opts.container,
      secretProvider: deps.secretProvider,
      instanceOwner: deps.instanceOwner,
      fetchImpl: deps.fetchImpl,
      primaryModelId,
      sessionId,
      tenantId,
      agentId,
    });
    if (!pipeline) return [];
    const index = new MemoryV1SemanticIndex({
      db: deps.opts.container.db,
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

async function ensureDefaultHeartbeatSchedule(
  deps: PrepareTurnDeps,
  agentId: string,
  workspaceId: string,
): Promise<void> {
  if (!deps.opts.container.deploymentConfig.automation.enabled) {
    return;
  }
  const scopeKey = `${deps.tenantId}:${agentId}:${workspaceId}`;
  if (deps.defaultHeartbeatSeededScopes.has(scopeKey)) {
    return;
  }

  const scheduleService = new ScheduleService(
    deps.opts.container.db,
    deps.opts.container.identityScopeDal,
  );
  await scheduleService.ensureDefaultHeartbeatScheduleForMembership({
    tenantId: deps.tenantId,
    agentId,
    workspaceId,
  });
  deps.defaultHeartbeatSeededScopes.add(scopeKey);
}

function maybeCleanupSessions(
  deps: PrepareTurnDeps,
  ttlDays: number,
  agentKey: string,
): void {
  const now = Date.now();
  if (now < deps.cleanupAtMs) {
    return;
  }
  void deps.sessionDal.deleteExpired(ttlDays, agentKey);
  deps.setCleanupAtMs(now + 60 * 60 * 1000);
}

async function loadAgentConfigFromDb(
  deps: PrepareTurnDeps,
  scope: { tenantId: string; agentId: string },
): Promise<AgentConfigT> {
  return (
    await new AgentConfigDal(deps.opts.container.db).ensureSeeded({
      tenantId: scope.tenantId,
      agentId: scope.agentId,
      defaultConfig: buildDefaultAgentConfig(
        resolveGatewayStateMode(deps.opts.container.deploymentConfig),
      ),
      createdBy: { kind: "agent-runtime" },
      reason: "seed",
    })
  ).config;
}

export async function prepareTurn(
  deps: PrepareTurnDeps,
  input: AgentTurnRequestT,
  exec?: TurnExecutionContext,
): Promise<PreparedTurn> {
  const resolved = resolveAgentTurnInput(input);
  const automation = resolveAutomationMetadata(resolved.metadata);
  const laneQueueScope = resolveLaneQueueScope(resolved.metadata);
  const agentKey = input.agent_key?.trim() || deps.agentId;
  const workspaceKey = input.workspace_key?.trim() || deps.workspaceId;

  const agentId = await deps.opts.container.identityScopeDal.ensureAgentId(
    deps.tenantId,
    agentKey,
  );
  const workspaceId = await deps.opts.container.identityScopeDal.ensureWorkspaceId(
    deps.tenantId,
    workspaceKey,
  );
  await deps.opts.container.identityScopeDal.ensureMembership(
    deps.tenantId,
    agentId,
    workspaceId,
  );
  await ensureDefaultHeartbeatSchedule(deps, agentId, workspaceId);

  const config = await loadAgentConfigFromDb(deps, {
    tenantId: deps.tenantId,
    agentId,
  });
  const ctx = await loadCurrentAgentContext({
    contextStore: deps.contextStore,
    tenantId: deps.tenantId,
    agentId,
    workspaceId,
    config,
  });
  maybeCleanupSessions(deps, ctx.config.sessions.ttl_days, agentKey);

  const containerKind: NormalizedContainerKind =
    input.container_kind ?? resolved.envelope?.container.kind ?? "channel";

  const parsedChannel = parseChannelSourceKey(resolved.channel);
  const connectorKey = parsedChannel.connector;
  const accountKey = resolved.envelope?.delivery.account ?? parsedChannel.accountId;

  const session = await deps.sessionDal.getOrCreate({
    tenantId: deps.tenantId,
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
    {
      laneQueueScope,
      metadata: resolved.metadata,
    },
  );

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
  const mcpSpecMap = new Map(
    ctx.mcpServers.map((server) => [server.id, server]),
  );

  const nodeDispatchService = deps.opts.protocolDeps
    ? new NodeDispatchService(deps.opts.protocolDeps)
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
  );

  const sessionCtx = formatSessionContext(session.summary, session.turns);
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

  const identityPrompt = formatIdentityPrompt(ctx.identity);
  const safetyPrompt = DATA_TAG_SAFETY_PROMPT;
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
    deps.opts.container.logger.warn("context_report.invalid", {
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
    { type: "text", text: skillsText },
    { type: "text", text: toolsText },
    { type: "text", text: sessionText },
    { type: "text", text: workFocusText },
    { type: "text", text: memoryText },
    ...(automationTriggerText
      ? [{ type: "text" as const, text: automationTriggerText }]
      : []),
    ...(automationDigestText
      ? [{ type: "text" as const, text: automationDigestText }]
      : []),
    { type: "text", text: resolved.message },
  ];

  const model = await resolveSessionModelImpl(
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
