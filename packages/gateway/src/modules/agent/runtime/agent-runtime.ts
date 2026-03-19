import { randomUUID } from "node:crypto";
import type { streamText } from "ai";
import type { LanguageModel } from "ai";
import type {
  AgentStatusResponse as AgentStatusResponseT,
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
} from "@tyrum/contracts";
import { AgentKey, WorkspaceKey } from "@tyrum/contracts";
import {
  type LaneQueueScope,
  type TurnEngineBridgeDeps,
  turnViaExecutionEngine as turnViaExecutionEngineBridge,
} from "./turn-engine-bridge.js";
import { createDefaultAgentContextStore, type AgentContextStore } from "../context-store.js";
import {
  ToolExecutionApprovalRequiredError,
  resolveAgentId,
  resolveAgentTurnInput,
  resolveLaneQueueScope,
  resolveTurnRequestId,
  type StepPauseRequest,
} from "./turn-helpers.js";
import type { AgentContextReport, AgentRuntimeOptions } from "./types.js";
import { resolveAgentHome, resolveTyrumHome } from "../home.js";
import { SessionDal } from "../session-dal.js";
import { McpManager } from "../mcp-manager.js";
import type { ApprovalDal } from "../../approval/dal.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "../../policy/service.js";
import { ExecutionEngine } from "../../execution/engine.js";
import { resolveWorkspaceKey } from "../../workspace/id.js";
import { DEFAULT_TENANT_ID } from "../../identity/scope.js";
import { createDisabledAgentStatus } from "./status-disabled.js";
import { resolveAutomationMetadata, maybeDeliverAutomationReply } from "./automation-delivery.js";
import { resolveExecutionProfile } from "./intake-delegation.js";
import type { PrepareTurnDeps } from "./turn-preparation.js";
import type { TurnExecutionContext } from "./turn-preparation.js";
import {
  turnDirect,
  turnStreamDirect,
  type GuardianReviewDecisionCollectorResult,
} from "./turn-direct.js";
import type { TurnDirectDeps } from "./turn-direct-runtime-helpers.js";
import {
  compactSessionWithResolvedModel,
  resolveRuntimeCompactionContext,
  type SessionCompactionResult,
} from "./session-compaction-service.js";
import type { ToolDescriptor } from "../tools.js";
import type { GuardianReviewDecision } from "../../review/guardian-review-mode.js";
import {
  buildEnabledAgentStatus,
  buildRegisteredToolsResult,
  listAvailableRuntimeTools,
  loadResolvedRuntimeContext,
} from "./agent-runtime-status.js";
import { resolveExistingRuntimeScopeIds } from "./scope-resolution.js";
import { normalizeInternalTurnRequestIfNeeded } from "./turn-request-normalization.js";

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_APPROVAL_WAIT_MS = 120_000;
const DEFAULT_APPROVAL_POLL_MS = 500;
const MAX_TURN_ENGINE_WAIT_MS = 60_000;
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
    const agentIdCandidate = opts.agentId?.trim() || resolveAgentId();
    const parsedAgentId = AgentKey.safeParse(agentIdCandidate);
    if (!parsedAgentId.success) {
      throw new Error(`invalid agent_id '${agentIdCandidate}' (${parsedAgentId.error.message})`);
    }
    this.agentId = parsedAgentId.data;

    this.home = opts.home ?? resolveAgentHome(resolveTyrumHome(), this.agentId);
    this.contextStore =
      opts.contextStore ??
      createDefaultAgentContextStore({
        home: this.home,
        container: opts.container,
      });
    this.sessionDal = opts.sessionDal ?? opts.container.sessionDal;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.tenantId = opts.tenantId?.trim() || DEFAULT_TENANT_ID;

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

  private async finalizeTurnLifecycle(input: {
    turnInput: AgentTurnRequestT;
    response: AgentTurnResponseT;
    contextReport?: AgentContextReport;
  }): Promise<AgentTurnResponseT> {
    if (input.contextReport) {
      this.lastContextReport = input.contextReport;
    }

    const automation = resolveAutomationMetadata(input.turnInput.metadata);
    if (automation && input.response.reply.trim().length > 0) {
      await maybeDeliverAutomationReply(
        {
          container: this.opts.container,
          tenantId: this.tenantId,
          agentId: this.agentId,
          workspaceId: this.workspaceId,
          policyService: this.policyService,
          approvalDal: this.approvalDal,
          protocolDeps: this.opts.protocolDeps,
        },
        { turnInput: input.turnInput, response: input.response, automation },
      );
    }

    return input.response;
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

  private get turnDirectDeps(): TurnDirectDeps {
    return {
      opts: this.opts,
      prepareTurnDeps: this.prepareTurnDeps,
      sessionDal: this.sessionDal,
      approvalDal: this.approvalDal,
      agentId: this.agentId,
      workspaceId: this.workspaceId,
      maxSteps: this.maxSteps,
      approvalWaitMs: this.approvalWaitMs,
      secretProvider: this.opts.secretProvider,
    };
  }

  async status(enabled: boolean): Promise<AgentStatusResponseT> {
    if (!enabled) {
      return createDisabledAgentStatus({ home: this.home, agentKey: this.agentId });
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
    const loaded = await loadResolvedRuntimeContext({
      opts: this.opts,
      contextStore: this.contextStore,
      tenantId: this.tenantId,
      agentId,
      agentKey: this.agentId,
      workspaceId,
    });
    const availableTools = await listAvailableRuntimeTools({
      opts: this.opts,
      mcpManager: this.mcpManager,
      mcpServers: loaded.mcpServers,
      plugins: this.plugins,
    });
    return buildEnabledAgentStatus({
      home: this.home,
      agentKey: this.agentId,
      loaded,
      availableTools,
    });
  }

  async listRegisteredTools(): Promise<{
    allowlist: string[];
    tools: ToolDescriptor[];
    mcpServers: string[];
  }> {
    const { agentId, workspaceId } = await resolveExistingRuntimeScopeIds({
      identityScopeDal: this.opts.container.identityScopeDal,
      tenantId: this.tenantId,
      agentKey: this.agentId,
      workspaceKey: this.workspaceId,
    });
    const loaded = await loadResolvedRuntimeContext({
      opts: this.opts,
      contextStore: this.contextStore,
      tenantId: this.tenantId,
      agentId,
      agentKey: this.agentId,
      workspaceId,
    });
    const availableTools = await listAvailableRuntimeTools({
      opts: this.opts,
      mcpManager: this.mcpManager,
      mcpServers: loaded.mcpServers,
      plugins: this.plugins,
    });
    return buildRegisteredToolsResult({
      loaded,
      availableTools,
    });
  }

  getLastContextReport(): AgentContextReport | undefined {
    return this.lastContextReport;
  }

  async turnStream(input: AgentTurnRequestT): Promise<{
    streamResult: ReturnType<typeof streamText>;
    sessionId: string;
    guardianReviewDecisionCollector?: GuardianReviewDecisionCollectorResult;
    finalize: () => Promise<AgentTurnResponseT>;
  }> {
    const normalizedInput = normalizeInternalTurnRequestIfNeeded(input);
    const result = await turnStreamDirect(this.turnDirectDeps, normalizedInput);
    this.lastContextReport = result.contextReport;
    return {
      streamResult: result.streamResult,
      sessionId: result.sessionId,
      guardianReviewDecisionCollector: result.guardianReviewDecisionCollector,
      finalize: async () =>
        await this.finalizeTurnLifecycle({
          turnInput: normalizedInput,
          response: await result.finalize(),
          contextReport: result.contextReport,
        }),
    };
  }

  async turn(input: AgentTurnRequestT): Promise<AgentTurnResponseT> {
    return await this.turnViaExecutionEngine(normalizeInternalTurnRequestIfNeeded(input));
  }

  async compactSession(input: {
    sessionId: string;
    keepLastMessages?: number;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<SessionCompactionResult> {
    const { ctx, session, modelResolution } = await resolveRuntimeCompactionContext({
      container: this.opts.container,
      contextStore: this.contextStore,
      sessionDal: this.sessionDal,
      resolveModelDeps: {
        container: this.opts.container,
        languageModelOverride: this.languageModelOverride,
        secretProvider: this.opts.secretProvider,
        oauthLeaseOwner: this.instanceOwner,
        fetchImpl: this.fetchImpl,
      },
      tenantId: this.tenantId,
      agentId: this.agentId,
      workspaceId: this.workspaceId,
      sessionId: input.sessionId,
    });

    return await compactSessionWithResolvedModel({
      container: this.opts.container,
      sessionDal: this.sessionDal,
      ctx,
      session,
      model: modelResolution.model,
      keepLastMessages: input.keepLastMessages,
      abortSignal: input.abortSignal,
      timeoutMs: input.timeoutMs,
      logger: this.opts.container.logger,
      prepareTurnDeps: this.prepareTurnDeps,
    });
  }

  async executeDecideAction(
    input: AgentTurnRequestT,
    opts?: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: TurnExecutionContext },
  ): Promise<AgentTurnResponseT> {
    const normalizedInput = normalizeInternalTurnRequestIfNeeded(input);
    const { response, contextReport } = await turnDirect(
      this.turnDirectDeps,
      normalizedInput,
      opts,
    );
    return await this.finalizeTurnLifecycle({
      turnInput: normalizedInput,
      response,
      contextReport,
    });
  }

  async executeGuardianReview(
    input: AgentTurnRequestT,
    opts?: { abortSignal?: AbortSignal; timeoutMs?: number },
  ): Promise<{
    response: AgentTurnResponseT;
    decision?: GuardianReviewDecision;
    calls: number;
    invalidCalls: number;
    error?: string;
  }> {
    const normalizedInput = normalizeInternalTurnRequestIfNeeded(input);
    const result = await turnDirect(this.turnDirectDeps, normalizedInput, opts);
    const response = await this.finalizeTurnLifecycle({
      turnInput: normalizedInput,
      response: result.response,
      contextReport: result.contextReport,
    });
    return {
      response,
      decision: result.guardianReviewDecisionCollector?.lastDecision,
      calls: result.guardianReviewDecisionCollector?.calls ?? 0,
      invalidCalls: result.guardianReviewDecisionCollector?.invalidCalls ?? 0,
      error: result.guardianReviewDecisionCollector?.lastError,
    };
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
      sessionLaneNodeAttachmentDal: this.opts.container.sessionLaneNodeAttachmentDal,
      resolveExecutionProfile: (args: {
        laneQueueScope?: LaneQueueScope;
        metadata?: Record<string, unknown>;
      }) =>
        resolveExecutionProfile(
          { container: this.opts.container, agentId: this.agentId, workspaceId: this.workspaceId },
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
        const { response, contextReport } = await turnDirect(
          this.turnDirectDeps,
          request,
          turnOpts,
        );
        return await this.finalizeTurnLifecycle({
          turnInput: request,
          response,
          contextReport,
        });
      },
      resolveAgentTurnInput,
      resolveLaneQueueScope,
      resolveTurnRequestId,
      isToolExecutionApprovalRequiredError: (err: unknown): err is { pause: StepPauseRequest } =>
        err instanceof ToolExecutionApprovalRequiredError,
    } satisfies TurnEngineBridgeDeps;

    return await turnViaExecutionEngineBridge(deps, input);
  }
}
