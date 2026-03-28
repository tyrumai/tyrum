import { randomUUID } from "node:crypto";
import type { LanguageModel, ToolSet } from "ai";
import type { AgentTurnRequest as AgentTurnRequestT } from "@tyrum/contracts";
import type { ConversationQueueState } from "./turn-engine-bridge.js";
import type { ToolCallPolicyState } from "./tool-set-builder.js";
import {
  isStatusQuery,
  resolveAgentTurnInput,
  resolveConversationQueueTarget,
  resolveMainConversationKey,
  type ResolvedAgentTurnInput,
} from "./turn-helpers.js";
import { resolveConversationModelDetailed as resolveConversationModelImpl } from "./conversation-model-resolution.js";
import type { ResolvedConversationModel } from "./conversation-model-resolution.js";
import {
  assemblePrompts,
  buildToolSetBuilderDeps,
  buildRuntimePrompt,
  resolveIdentityAndContext,
  resolveToolExecutionRuntime,
} from "./turn-preparation-runtime.js";
import { runPreTurnHydration } from "./preturn-hydration.js";
import { buildWorkFocusDigest } from "./work-focus-digest.js";
import type { AgentContextReport, AgentLoadedContext, AgentRuntimeOptions } from "./types.js";
import { resolveAutomationMetadata, buildAutomationDigest } from "./automation-delivery.js";
import {
  resolveExecutionProfile,
  type ResolvedExecutionProfile,
} from "./execution-profile-resolution.js";
import { ToolSetBuilder } from "./tool-set-builder.js";
import type { AgentContextStore } from "../context-store.js";
import type { ConversationRow } from "../conversation-dal.js";
import { ConversationDal } from "../conversation-dal.js";
import { McpManager } from "../mcp-manager.js";
import type { ToolExecutor } from "../tool-executor.js";
import { ConversationQueueSignalDal } from "../../conversation-queue/queue-signal-dal.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
import type { SecretProvider } from "../../secret/provider.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { ApprovalDal } from "../../approval/dal.js";
import { buildContextReport } from "./turn-context-report.js";
import {
  buildGuardianReviewSystemPrompt,
  createGuardianReviewDecisionCollector,
  resolveGuardianReviewRequest,
  type GuardianReviewDecisionCollector,
} from "../../review/guardian-review-mode.js";
import {
  prepareAttachmentInputForPrompt,
  type AttachmentUserContentPart,
} from "./attachment-analysis.js";
import { normalizeInternalTurnRequestIfNeeded } from "./turn-request-normalization.js";
import { resolveSandboxPrompt } from "./sandbox-context.js";
import { buildToolExecutionContext } from "./tool-execution-context.js";
import {
  buildCurrentTurnUserContent,
  mergeAutomationContextSections,
} from "./turn-prompt-content.js";
export type TurnExecutionContext = {
  planId: string;
  turnId: string;
  stepIndex: number;
  stepId: string;
  stepApprovalId?: string;
};

export type PreparedTurn = {
  ctx: AgentLoadedContext;
  executionProfile: ResolvedExecutionProfile;
  conversation: ConversationRow;
  mainConversationKey: string;
  model: LanguageModel;
  modelResolution: ResolvedConversationModel;
  toolSet: ToolSet;
  toolCallPolicyStates: Map<string, ToolCallPolicyState>;
  queueState?: ConversationQueueState;
  usedTools: Set<string>;
  memoryWriteState: { wrote: boolean };
  userContent: AttachmentUserContentPart[];
  rewriteHistoryAttachmentsForModel: boolean;
  contextReport: AgentContextReport;
  systemPrompt: string;
  resolved: ResolvedAgentTurnInput;
  guardianReviewDecisionCollector?: GuardianReviewDecisionCollector;
};
export type PrepareTurnDeps = {
  opts: AgentRuntimeOptions;
  home: string;
  contextStore: AgentContextStore;
  conversationDal: ConversationDal;
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
  const normalizedInput = normalizeInternalTurnRequestIfNeeded(input);
  const resolvedInput = resolveAgentTurnInput(normalizedInput);
  const automation = resolveAutomationMetadata(resolvedInput.metadata);
  const queueTarget = resolveConversationQueueTarget(resolvedInput.metadata);

  const { agentKey, workspaceKey, ctx, containerKind, connectorKey, accountKey } =
    await resolveIdentityAndContext(deps, normalizedInput, resolvedInput);

  const conversation = await deps.conversationDal.getOrCreate({
    tenantId: deps.tenantId,
    scopeKeys: { agentKey, workspaceKey },
    connectorKey,
    accountKey,
    providerThreadId: resolvedInput.thread_id,
    containerKind,
  });

  const queueState: ConversationQueueState | undefined = queueTarget
    ? {
        tenant_id: conversation.tenant_id,
        target: queueTarget,
        signals: new ConversationQueueSignalDal(deps.opts.container.db),
        interruptError: undefined,
        cancelToolCalls: false,
        pendingInjectionTexts: [],
      }
    : undefined;

  const mainConversationKey = resolveMainConversationKey({
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
      work_conversation_key:
        typeof resolvedInput.metadata?.["work_conversation_key"] === "string"
          ? resolvedInput.metadata["work_conversation_key"]
          : mainConversationKey,
    },
  };

  const executionProfile = await resolveExecutionProfile(
    {
      container: deps.opts.container,
      agentId: deps.agentId,
      workspaceId: deps.workspaceId,
    },
    { queueTarget, metadata: resolved.metadata },
  );

  const guardianReviewRequest = resolveGuardianReviewRequest(resolved.metadata);
  const guardianReviewToolSetBuilder = guardianReviewRequest
    ? new ToolSetBuilder(buildToolSetBuilderDeps(deps, conversation, executionProfile.profile))
    : undefined;
  const normalTurnContext = guardianReviewRequest
    ? undefined
    : await resolveToolExecutionRuntime(deps, ctx, conversation, resolved, executionProfile, {
        memoryProvenance: {
          channel: resolved.channel,
          threadId: resolved.thread_id,
        },
      });
  const availableTools = normalTurnContext?.availableTools ?? [];
  const toolSetBuilderDeps = normalTurnContext?.toolSetBuilderDeps;
  const filteredTools = normalTurnContext?.filteredTools ?? [];
  const resolvedToolSetBuilder = normalTurnContext?.toolSetBuilder ?? guardianReviewToolSetBuilder;
  const toolExecutor = normalTurnContext?.toolExecutor;
  const activeToolExecutor = (toolExecutor ??
    ({
      execute: async () => ({
        tool_call_id: "guardian-review",
        output: "",
        error: "guardian review mode does not expose normal tools",
      }),
    } satisfies Pick<ToolExecutor, "execute">)) as ToolExecutor;
  if (!resolvedToolSetBuilder) {
    throw new Error("tool set builder unavailable for turn preparation");
  }
  if (!guardianReviewRequest && !toolExecutor) {
    throw new Error("tool executor unavailable for turn preparation");
  }

  const workFocusDigest = guardianReviewRequest
    ? "Skipped in guardian review mode."
    : isStatusQuery(resolved.message)
      ? "Skipped for command turns."
      : await buildWorkFocusDigest({
          container: deps.opts.container,
          scope: {
            tenant_id: conversation.tenant_id,
            agent_id: conversation.agent_id,
            workspace_id: conversation.workspace_id,
          },
        });
  const workFocusText = `Active work state:\n${workFocusDigest}`;
  const runtimePrompt = guardianReviewRequest
    ? undefined
    : await buildRuntimePrompt({
        nowIso: new Date().toISOString(),
        agentId: conversation.agent_id,
        workspaceId: conversation.workspace_id,
        conversationId: conversation.conversation_id,
        channel: resolved.channel,
        threadId: resolved.thread_id,
        home: deps.home,
        stateMode: resolveGatewayStateMode(deps.opts.container.deploymentConfig),
        model: executionProfile.profile.model_id ?? executionProfile.id,
      });

  const modelResolution = await resolveConversationModelImpl(
    {
      container: deps.opts.container,
      languageModelOverride: deps.languageModelOverride,
      secretProvider: deps.secretProvider,
      oauthLeaseOwner: deps.instanceOwner,
      fetchImpl: deps.fetchImpl,
    },
    {
      config: ctx.config,
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
      executionProfileId: executionProfile.id,
      profileModelId: executionProfile.profile.model_id,
      fetchImpl: deps.fetchImpl,
    },
  );
  const model = modelResolution.model;
  const toolExecutionContext = buildToolExecutionContext({
    tenantId: conversation.tenant_id,
    conversationId: conversation.conversation_id,
    channel: resolved.channel,
    threadId: resolved.thread_id,
    metadata: resolved.metadata,
    planId: exec?.planId ?? `agent-turn-${conversation.conversation_id}-${randomUUID()}`,
    execution: exec
      ? {
          turnId: exec.turnId,
          stepIndex: exec.stepIndex,
          stepId: exec.stepId,
          stepApprovalId: exec.stepApprovalId,
        }
      : undefined,
  });
  const preTurnHydration =
    guardianReviewRequest ||
    isStatusQuery(resolved.message) ||
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
          toolExecutor: activeToolExecutor,
          toolSetBuilderDeps,
          toolExecutionContext,
          conversation,
          resolved,
        });

  const sandboxPrompt = await resolveSandboxPrompt({
    skip: Boolean(guardianReviewRequest),
    db: deps.opts.container.db,
    defaultDeploymentConfig: deps.opts.container.deploymentConfig,
    tenantId: conversation.tenant_id,
    key:
      typeof resolved.metadata?.["work_conversation_key"] === "string"
        ? resolved.metadata["work_conversation_key"]
        : mainConversationKey,
    hardeningProfile: deps.opts.container.deploymentConfig.toolrunner.hardeningProfile,
  });
  const guardianReviewDecisionCollector = guardianReviewRequest
    ? createGuardianReviewDecisionCollector(guardianReviewRequest.subjectType)
    : undefined;

  const promptParts = guardianReviewRequest
    ? {
        identityPrompt: "",
        promptContractPrompt: "",
        runtimePromptText: "",
        safetyPrompt: "",
        skillsText: "Skill guidance:\nGuardian review mode disables normal skill guidance.",
        toolsText: "Tool contracts:\nguardian_review_decision",
        workOrchestrationText: undefined as string | undefined,
        memoryGuidanceText: undefined as string | undefined,
        conversationText:
          "Conversation state:\nGuardian review mode relies on the supplied review request evidence.",
        preTurnTexts: [] as string[],
        automationDirectiveText: undefined as string | undefined,
        automationContextText: undefined as string | undefined,
      }
    : (() => {
        const assembled = assemblePrompts(
          ctx,
          conversation,
          filteredTools,
          preTurnHydration.sections.map((section) => section.text),
          automation,
          runtimePrompt ?? "",
        );
        return {
          identityPrompt: assembled.identityPrompt,
          promptContractPrompt: assembled.promptContractPrompt,
          runtimePromptText: assembled.runtimePrompt,
          safetyPrompt: assembled.safetyPrompt,
          skillsText: assembled.skillsText,
          toolsText: assembled.toolsText,
          workOrchestrationText: assembled.workOrchestrationText,
          memoryGuidanceText: assembled.memoryGuidanceText,
          conversationText: assembled.conversationText,
          preTurnTexts: assembled.preTurnTexts,
          automationDirectiveText: assembled.automationDirectiveText,
          automationContextText: assembled.automationContextText,
        };
      })();

  const systemPrompt = guardianReviewRequest
    ? buildGuardianReviewSystemPrompt(guardianReviewRequest.subjectType)
    : [
        promptParts.identityPrompt,
        promptParts.promptContractPrompt,
        promptParts.runtimePromptText,
        promptParts.safetyPrompt,
        sandboxPrompt,
        promptParts.skillsText,
        promptParts.toolsText,
        promptParts.workOrchestrationText,
        promptParts.memoryGuidanceText,
      ]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join("\n\n");

  const automationDigestBody =
    guardianReviewRequest || !automation
      ? undefined
      : await buildAutomationDigest({
          container: deps.opts.container,
          scope: {
            tenant_id: conversation.tenant_id,
            agent_id: conversation.agent_id,
            workspace_id: conversation.workspace_id,
          },
          automation,
        });
  const automationContextText = guardianReviewRequest
    ? undefined
    : mergeAutomationContextSections(promptParts.automationContextText, automationDigestBody);
  const attachmentInput = guardianReviewRequest
    ? {
        inputMode: ctx.config.attachments.input_mode,
        currentTurnParts: [{ type: "text", text: resolved.message }] as AttachmentUserContentPart[],
        shouldRewriteHistoryForModel: false,
        helperSummaryText: undefined,
      }
    : await prepareAttachmentInputForPrompt({
        deps: {
          container: deps.opts.container,
          fetchImpl: deps.fetchImpl,
          secretProvider: deps.secretProvider,
          languageModelOverride: deps.languageModelOverride,
          instanceOwner: deps.instanceOwner,
          tenantId: conversation.tenant_id,
          conversationId: conversation.conversation_id,
          agentConfig: ctx.config,
          deploymentConfig: deps.opts.container.deploymentConfig,
          primaryModel: model,
        },
        parts: resolved.parts,
      });
  const promptPreTurnTexts = attachmentInput.helperSummaryText
    ? [...promptParts.preTurnTexts, `Attachment analysis:\n${attachmentInput.helperSummaryText}`]
    : [...promptParts.preTurnTexts];

  const validatedReport = buildContextReport({
    conversation,
    resolved,
    ctx,
    executionProfile,
    filteredTools,
    systemPrompt,
    identityPrompt: promptParts.identityPrompt,
    promptContractPrompt: promptParts.promptContractPrompt,
    runtimePrompt: promptParts.runtimePromptText,
    safetyPrompt: promptParts.safetyPrompt,
    sandboxPrompt,
    skillsText: promptParts.skillsText,
    toolsText: promptParts.toolsText,
    workOrchestrationText: promptParts.workOrchestrationText,
    memoryGuidanceText: promptParts.memoryGuidanceText,
    conversationText: promptParts.conversationText,
    workFocusText,
    preTurnTexts: promptPreTurnTexts,
    preTurnReports: preTurnHydration.reports,
    automationDirectiveText: promptParts.automationDirectiveText,
    automationContextText,
    memorySummary: preTurnHydration.memory,
    automation,
    logger: deps.opts.container.logger,
  });

  const usedTools = new Set<string>();
  const memoryWriteState = { wrote: false };
  const toolCallPolicyStates = new Map<string, ToolCallPolicyState>();
  const toolSet = resolvedToolSetBuilder.buildToolSet(
    filteredTools,
    activeToolExecutor,
    usedTools,
    toolExecutionContext,
    validatedReport,
    queueState,
    toolCallPolicyStates,
    model,
    memoryWriteState,
    guardianReviewDecisionCollector,
  );

  const userContent: AttachmentUserContentPart[] = guardianReviewRequest
    ? [{ type: "text", text: resolved.message }]
    : [
        { type: "text", text: promptParts.conversationText },
        { type: "text", text: workFocusText },
        ...promptPreTurnTexts.map((text) => ({ type: "text" as const, text })),
        ...(promptParts.automationDirectiveText
          ? [{ type: "text" as const, text: promptParts.automationDirectiveText }]
          : []),
        ...(automationContextText ? [{ type: "text" as const, text: automationContextText }] : []),
        ...buildCurrentTurnUserContent(resolved.message, attachmentInput.currentTurnParts),
      ];

  return {
    ctx,
    executionProfile,
    conversation,
    mainConversationKey,
    model,
    modelResolution,
    toolSet,
    toolCallPolicyStates,
    queueState,
    usedTools,
    memoryWriteState,
    userContent,
    rewriteHistoryAttachmentsForModel: attachmentInput.shouldRewriteHistoryForModel,
    contextReport: validatedReport,
    systemPrompt,
    resolved,
    guardianReviewDecisionCollector,
  };
}
