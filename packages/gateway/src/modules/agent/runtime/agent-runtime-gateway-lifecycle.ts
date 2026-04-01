import type { streamText } from "ai";
import type { AgentTurnRequest as AgentTurnRequestT } from "@tyrum/contracts";
import type {
  AgentRuntimeContext as RuntimeAgentContext,
  AgentRuntimeLifecycle,
} from "@tyrum/runtime-agent";
import {
  type ConversationQueueTarget,
  type TurnEngineBridgeDeps,
  type TurnEngineStreamBridgeDeps,
} from "./turn-engine-bridge.js";
import { turnViaTurnRunner } from "./turn-via-turn-runner.js";
import {
  ToolExecutionApprovalRequiredError,
  resolveAgentTurnInput,
  resolveConversationQueueTarget,
  resolveTurnRequestId,
  type StepPauseRequest,
} from "./turn-helpers.js";
import type { AgentContextReport, AgentRuntimeOptions } from "./types.js";
import type { AgentContextStore } from "../context-store.js";
import { ConversationDal } from "../conversation-dal.js";
import { McpManager } from "../mcp-manager.js";
import type { ApprovalDal } from "../../approval/dal.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import { ExecutionEngine } from "../../execution/engine.js";
import { createDisabledAgentStatus } from "./status-disabled.js";
import { resolveAutomationMetadata, maybeDeliverAutomationReply } from "./automation-delivery.js";
import { resolveExecutionProfile } from "./execution-profile-resolution.js";
import type { PrepareTurnDeps } from "./turn-preparation.js";
import type { TurnExecutionContext } from "./turn-preparation.js";
import {
  turnDirect,
  turnStreamDirect,
  type GuardianReviewDecisionCollectorResult,
} from "./turn-direct.js";
import type { TurnDirectDeps } from "./turn-direct-runtime-helpers.js";
import {
  compactConversationWithResolvedModel,
  resolveRuntimeCompactionContext,
  type ConversationCompactionResult,
} from "./conversation-compaction-service.js";
import type { ToolDescriptor } from "../tools.js";
import type { GuardianReviewDecision } from "../../review/guardian-review-mode.js";
import {
  buildEnabledAgentStatus,
  buildRegisteredToolsResult,
  listAvailableRuntimeTools,
  loadResolvedRuntimeContext,
} from "./agent-runtime-status.js";
import { resolveExistingRuntimeScopeIds } from "./scope-resolution.js";

export type GatewayAgentRuntimeDeps = {
  opts: AgentRuntimeOptions;
  contextStore: AgentContextStore;
  conversationDal: ConversationDal;
  fetchImpl: typeof fetch;
  mcpManager: McpManager;
  policyService: PolicyService;
  approvalDal: ApprovalDal;
};

export type GatewayRuntimeContext = RuntimeAgentContext<
  GatewayAgentRuntimeDeps,
  PluginRegistry,
  ExecutionEngine,
  AgentContextReport
>;

export type GatewayRuntimeLifecycle = AgentRuntimeLifecycle<
  GatewayAgentRuntimeDeps,
  PluginRegistry,
  ExecutionEngine,
  AgentContextReport,
  ToolDescriptor,
  GuardianReviewDecision,
  GuardianReviewDecisionCollectorResult,
  ConversationCompactionResult,
  ReturnType<typeof streamText>
>;

export function buildPrepareTurnDeps(context: GatewayRuntimeContext): PrepareTurnDeps {
  return {
    opts: context.deps.opts,
    home: context.home,
    contextStore: context.deps.contextStore,
    conversationDal: context.deps.conversationDal,
    fetchImpl: context.deps.fetchImpl,
    tenantId: context.tenantId,
    agentId: context.agentId,
    workspaceId: context.workspaceId,
    instanceOwner: context.instanceOwner,
    languageModelOverride: context.languageModelOverride,
    mcpManager: context.deps.mcpManager,
    plugins: context.plugins,
    policyService: context.deps.policyService,
    approvalDal: context.deps.approvalDal,
    approvalWaitMs: context.approvalWaitMs,
    approvalPollMs: context.approvalPollMs,
    secretProvider: context.deps.opts.secretProvider,
    defaultHeartbeatSeededScopes: context.defaultHeartbeatSeededScopes,
    cleanupAtMs: context.cleanupAtMs,
    setCleanupAtMs: (ms: number) => {
      context.cleanupAtMs = ms;
    },
  };
}

export function buildTurnDirectDeps(context: GatewayRuntimeContext): TurnDirectDeps {
  return {
    opts: context.deps.opts,
    prepareTurnDeps: buildPrepareTurnDeps(context),
    conversationDal: context.deps.conversationDal,
    approvalDal: context.deps.approvalDal,
    agentId: context.agentId,
    workspaceId: context.workspaceId,
    maxSteps: context.maxSteps,
    approvalWaitMs: context.approvalWaitMs,
    secretProvider: context.deps.opts.secretProvider,
  };
}

export function buildTurnEngineBridgeDeps(
  context: GatewayRuntimeContext,
  onContextReport?: (report: AgentContextReport) => void,
): TurnEngineBridgeDeps & TurnEngineStreamBridgeDeps {
  return {
    tenantId: context.tenantId,
    agentKey: context.agentId,
    workspaceKey: context.workspaceId,
    identityScopeDal: context.deps.opts.container.identityScopeDal,
    executionEngine: context.executionPort,
    executionWorkerId: context.executionWorkerId,
    turnEngineWaitMs: context.turnEngineWaitMs,
    approvalPollMs: context.approvalPollMs,
    db: context.deps.opts.container.db,
    approvalDal: context.deps.approvalDal,
    conversationNodeAttachmentDal: context.deps.opts.container.conversationNodeAttachmentDal,
    redactText: (text: string) =>
      context.deps.opts.container.redactionEngine.redactText(text).redacted,
    redactUnknown: <T>(value: T) =>
      context.deps.opts.container.redactionEngine.redactUnknown(value).redacted as T,
    resolveExecutionProfile: (args: {
      queueTarget?: ConversationQueueTarget;
      metadata?: Record<string, unknown>;
    }) =>
      resolveExecutionProfile(
        {
          container: context.deps.opts.container,
          agentId: context.agentId,
          workspaceId: context.workspaceId,
        },
        args,
      ),
    turnDirect: async (
      request: AgentTurnRequestT,
      turnOpts?: {
        abortSignal?: AbortSignal;
        timeoutMs?: number;
        execution?: TurnExecutionContext;
      },
    ) => {
      const result = await turnDirect(buildTurnDirectDeps(context), request, turnOpts);
      onContextReport?.(result.contextReport);
      return result.response;
    },
    turnStream: async (
      request: AgentTurnRequestT,
      turnOpts?: {
        abortSignal?: AbortSignal;
        timeoutMs?: number;
        execution?: TurnExecutionContext;
      },
    ) => {
      const result = await turnStreamDirect(buildTurnDirectDeps(context), request, turnOpts);
      onContextReport?.(result.contextReport);
      return result;
    },
    resolveAgentTurnInput,
    resolveConversationQueueTarget,
    resolveTurnRequestId,
    isToolExecutionApprovalRequiredError: (err: unknown): err is { pause: StepPauseRequest } =>
      err instanceof ToolExecutionApprovalRequiredError,
  };
}

export const gatewayRuntimeLifecycle: GatewayRuntimeLifecycle = {
  finalizeTurnLifecycle: async (context, input) => {
    const automation = resolveAutomationMetadata(input.turnInput.metadata);
    if (automation && input.response.reply.trim().length > 0) {
      await maybeDeliverAutomationReply(
        {
          container: context.deps.opts.container,
          tenantId: context.tenantId,
          agentId: context.agentId,
          workspaceId: context.workspaceId,
          policyService: context.deps.policyService,
          approvalDal: context.deps.approvalDal,
          protocolDeps: context.deps.opts.protocolDeps,
        },
        { turnInput: input.turnInput, response: input.response, automation },
      );
    }

    return input.response;
  },
  status: async (context, enabled) => {
    if (!enabled) {
      return createDisabledAgentStatus({ home: context.home, agentKey: context.agentId });
    }
    const agentId = await context.deps.opts.container.identityScopeDal.ensureAgentId(
      context.tenantId,
      context.agentId,
    );
    const workspaceId = await context.deps.opts.container.identityScopeDal.ensureWorkspaceId(
      context.tenantId,
      context.workspaceId,
    );
    await context.deps.opts.container.identityScopeDal.ensureMembership(
      context.tenantId,
      agentId,
      workspaceId,
    );
    const loaded = await loadResolvedRuntimeContext({
      opts: context.deps.opts,
      contextStore: context.deps.contextStore,
      tenantId: context.tenantId,
      agentId,
      agentKey: context.agentId,
      workspaceId,
    });
    const availableTools = await listAvailableRuntimeTools({
      opts: context.deps.opts,
      mcpManager: context.deps.mcpManager,
      mcpServers: loaded.mcpServers,
      plugins: context.plugins,
    });
    return buildEnabledAgentStatus({
      home: context.home,
      agentKey: context.agentId,
      loaded,
      availableTools,
    });
  },
  listRegisteredTools: async (context) => {
    const { agentId, workspaceId } = await resolveExistingRuntimeScopeIds({
      identityScopeDal: context.deps.opts.container.identityScopeDal,
      tenantId: context.tenantId,
      agentKey: context.agentId,
      workspaceKey: context.workspaceId,
    });
    const loaded = await loadResolvedRuntimeContext({
      opts: context.deps.opts,
      contextStore: context.deps.contextStore,
      tenantId: context.tenantId,
      agentId,
      agentKey: context.agentId,
      workspaceId,
    });
    const availableTools = await listAvailableRuntimeTools({
      opts: context.deps.opts,
      mcpManager: context.deps.mcpManager,
      mcpServers: loaded.mcpServers,
      plugins: context.plugins,
    });
    return buildRegisteredToolsResult({
      loaded,
      availableTools,
    });
  },
  turn: async (context, input) => {
    let contextReport: AgentContextReport | undefined;
    const deps = buildTurnEngineBridgeDeps(context, (next) => {
      contextReport = next;
    });

    return {
      response: await turnViaTurnRunner(deps, input),
      contextReport,
    };
  },
  turnStream: async (context, input) => {
    const result = await turnStreamDirect(buildTurnDirectDeps(context), input);
    return {
      streamResult: result.streamResult,
      conversationId: result.conversationId,
      guardianReviewDecisionCollector: result.guardianReviewDecisionCollector,
      contextReport: result.contextReport,
      finalize: result.finalize,
    };
  },
  compactConversation: async (context, input) => {
    const { ctx, conversation, modelResolution } = await resolveRuntimeCompactionContext({
      container: context.deps.opts.container,
      contextStore: context.deps.contextStore,
      conversationDal: context.deps.conversationDal,
      resolveModelDeps: {
        container: context.deps.opts.container,
        languageModelOverride: context.languageModelOverride,
        secretProvider: context.deps.opts.secretProvider,
        oauthLeaseOwner: context.instanceOwner,
        fetchImpl: context.deps.fetchImpl,
      },
      tenantId: context.tenantId,
      agentId: context.agentId,
      workspaceId: context.workspaceId,
      conversationId: input.conversationId,
    });

    return await compactConversationWithResolvedModel({
      container: context.deps.opts.container,
      conversationDal: context.deps.conversationDal,
      ctx,
      conversation,
      model: modelResolution.model,
      keepLastMessages: input.keepLastMessages,
      abortSignal: input.abortSignal,
      timeoutMs: input.timeoutMs,
      logger: context.deps.opts.container.logger,
      prepareTurnDeps: buildPrepareTurnDeps(context),
    });
  },
  executeDecideAction: async (context, input, opts) =>
    await turnDirect(buildTurnDirectDeps(context), input, {
      abortSignal: opts?.abortSignal,
      timeoutMs: opts?.timeoutMs,
      execution: opts?.execution as TurnExecutionContext | undefined,
    }),
  executeGuardianReview: async (context, input, opts) => {
    const result = await turnDirect(buildTurnDirectDeps(context), input, opts);
    return {
      response: result.response,
      contextReport: result.contextReport,
      decision: result.guardianReviewDecisionCollector?.lastDecision,
      calls: result.guardianReviewDecisionCollector?.calls ?? 0,
      invalidCalls: result.guardianReviewDecisionCollector?.invalidCalls ?? 0,
      error: result.guardianReviewDecisionCollector?.lastError,
    };
  },
};
