import { randomUUID } from "node:crypto";
import type { streamText } from "ai";
import type { LanguageModel } from "ai";
import type {
  AgentStatusResponse as AgentStatusResponseT,
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
} from "@tyrum/schemas";
import { AgentKey, AgentStatusResponse, WorkspaceKey } from "@tyrum/schemas";
import {
  type LaneQueueScope,
  type TurnEngineBridgeDeps,
  turnViaExecutionEngine as turnViaExecutionEngineBridge,
} from "./turn-engine-bridge.js";
import { ensureAgentConfigSeeded } from "../default-config.js";
import { createDefaultAgentContextStore, type AgentContextStore } from "../context-store.js";
import { loadCurrentAgentContext } from "../load-context.js";
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
import { resolveExistingRuntimeScopeIds } from "./scope-resolution.js";
import { createDisabledAgentStatus } from "./status-disabled.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
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
import { materializeAllowedAgentIds } from "../access-config.js";
import { applyPersonaToIdentity, resolveAgentPersona } from "../persona.js";
import {
  isBuiltinToolAvailableInStateMode,
  listBuiltinToolDescriptors,
  type ToolDescriptor,
} from "../tools.js";
import type { GuardianReviewDecision } from "../../review/guardian-review-mode.js";

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

    const { agentId, workspaceId } = await resolveExistingRuntimeScopeIds({
      identityScopeDal: this.opts.container.identityScopeDal,
      tenantId: this.tenantId,
      agentKey: this.agentId,
      workspaceKey: this.workspaceId,
    });
    const config = await (
      await ensureAgentConfigSeeded({
        db: this.opts.container.db,
        stateMode: resolveGatewayStateMode(this.opts.container.deploymentConfig),
        tenantId: this.tenantId,
        agentId,
        agentKey: this.agentId,
        createdBy: { kind: "agent-runtime" },
        reason: "seed",
      })
    ).config;
    const loaded = await loadCurrentAgentContext({
      contextStore: this.contextStore,
      tenantId: this.tenantId,
      agentId,
      workspaceId,
      config,
    });
    const persona = resolveAgentPersona({
      agentKey: this.agentId,
      config: loaded.config,
      identity: loaded.identity,
    });
    const ctx = {
      ...loaded,
      identity: applyPersonaToIdentity(loaded.identity, persona),
    };
    const stateMode = resolveGatewayStateMode(this.opts.container.deploymentConfig);
    const builtinTools = listBuiltinToolDescriptors();
    const builtinToolIds = new Set(builtinTools.map((tool) => tool.id));
    const mcpTools = await this.mcpManager.listToolDescriptors(ctx.mcpServers);
    const pluginTools = this.plugins?.getToolDescriptors() ?? [];
    const availableTools = Array.from(
      new Map(
        [...builtinTools, ...mcpTools, ...pluginTools]
          .filter((tool) => {
            const isBuiltinTool =
              tool.source === "builtin" ||
              tool.source === "builtin_mcp" ||
              (tool.source === undefined && builtinToolIds.has(tool.id));
            return !isBuiltinTool || isBuiltinToolAvailableInStateMode(tool.id, stateMode);
          })
          .map((tool) => [tool.id, tool] as const),
      ).values(),
    );
    const status = {
      enabled: true,
      home: this.home,
      persona,
      identity: {
        name: ctx.identity.meta.name,
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
      tools: materializeAllowedAgentIds(ctx.config.tools, availableTools).map((tool) => tool.id),
      tool_access: ctx.config.tools,
      sessions: ctx.config.sessions,
    };

    return AgentStatusResponse.parse(status);
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
    const config = await (
      await ensureAgentConfigSeeded({
        db: this.opts.container.db,
        stateMode: resolveGatewayStateMode(this.opts.container.deploymentConfig),
        tenantId: this.tenantId,
        agentId,
        agentKey: this.agentId,
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

    const mcpTools = await this.mcpManager.listToolDescriptors(ctx.mcpServers);
    const pluginTools = this.plugins?.getToolDescriptors() ?? [];
    const byId = new Map<string, ToolDescriptor>();
    for (const tool of [...listBuiltinToolDescriptors(), ...mcpTools, ...pluginTools]) {
      if (!byId.has(tool.id)) {
        byId.set(tool.id, tool);
      }
    }

    return {
      allowlist: materializeAllowedAgentIds(ctx.config.tools, Array.from(byId.values())).map(
        (tool) => tool.id,
      ),
      tools: Array.from(byId.values()).toSorted((left, right) => left.id.localeCompare(right.id)),
      mcpServers: ctx.mcpServers.map((server) => server.id),
    };
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
    const result = await turnStreamDirect(this.turnDirectDeps, input);
    this.lastContextReport = result.contextReport;
    return {
      streamResult: result.streamResult,
      sessionId: result.sessionId,
      guardianReviewDecisionCollector: result.guardianReviewDecisionCollector,
      finalize: async () =>
        await this.finalizeTurnLifecycle({
          turnInput: input,
          response: await result.finalize(),
          contextReport: result.contextReport,
        }),
    };
  }

  async turn(input: AgentTurnRequestT): Promise<AgentTurnResponseT> {
    return await this.turnViaExecutionEngine(input);
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
    });
  }

  async executeDecideAction(
    input: AgentTurnRequestT,
    opts?: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: TurnExecutionContext },
  ): Promise<AgentTurnResponseT> {
    const { response, contextReport } = await turnDirect(this.turnDirectDeps, input, opts);
    return await this.finalizeTurnLifecycle({
      turnInput: input,
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
    const result = await turnDirect(this.turnDirectDeps, input, opts);
    const response = await this.finalizeTurnLifecycle({
      turnInput: input,
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
