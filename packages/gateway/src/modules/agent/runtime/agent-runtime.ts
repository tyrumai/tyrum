import type { streamText } from "ai";
import type {
  AgentStatusResponse as AgentStatusResponseT,
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
} from "@tyrum/contracts";
import { AgentRuntime as RuntimeAgent } from "@tyrum/runtime-agent";
import {
  buildPrepareTurnDeps,
  buildTurnDirectDeps,
  gatewayRuntimeLifecycle,
  type GatewayAgentRuntimeDeps,
} from "./agent-runtime-gateway-lifecycle.js";
import { createDefaultAgentContextStore, type AgentContextStore } from "../context-store.js";
import { resolveAgentId } from "./turn-helpers.js";
import type { AgentContextReport, AgentRuntimeOptions } from "./types.js";
import { resolveAgentHome, resolveTyrumHome } from "../home.js";
import { SessionDal } from "../session-dal.js";
import { McpManager } from "../mcp-manager.js";
import type { ApprovalDal } from "../../approval/dal.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import { ExecutionEngine } from "../../execution/engine.js";
import { resolveWorkspaceKey } from "../../workspace/id.js";
import { DEFAULT_TENANT_ID } from "../../identity/scope.js";
import type { PrepareTurnDeps } from "./turn-preparation.js";
import type { TurnExecutionContext } from "./turn-preparation.js";
import { type GuardianReviewDecisionCollectorResult } from "./turn-direct.js";
import type { TurnDirectDeps } from "./turn-direct-runtime-helpers.js";
import { type SessionCompactionResult } from "./session-compaction-service.js";
import type { ToolDescriptor } from "../tools.js";
import type { GuardianReviewDecision } from "../../review/guardian-review-mode.js";

export class AgentRuntime {
  public readonly executionEngine: ExecutionEngine;
  public readonly opts: AgentRuntimeOptions;
  private readonly runtime: RuntimeAgent<
    GatewayAgentRuntimeDeps,
    PluginRegistry,
    ExecutionEngine,
    AgentContextReport,
    ToolDescriptor,
    GuardianReviewDecision,
    GuardianReviewDecisionCollectorResult,
    SessionCompactionResult,
    ReturnType<typeof streamText>
  >;

  constructor(opts: AgentRuntimeOptions) {
    this.opts = opts;
    const agentIdCandidate = opts.agentId?.trim() || resolveAgentId();
    const home = opts.home ?? resolveAgentHome(resolveTyrumHome(), agentIdCandidate);
    const contextStore =
      opts.contextStore ??
      createDefaultAgentContextStore({
        home,
        container: opts.container,
      });
    const sessionDal = opts.sessionDal ?? opts.container.sessionDal;
    const fetchImpl = opts.fetchImpl ?? fetch;
    const mcpManager = opts.mcpManager ?? new McpManager({ logger: opts.container.logger });
    const policyService = opts.policyService ?? opts.container.policyService;
    const approvalDal = opts.approvalDal ?? opts.container.approvalDal;
    const executionEngine = new ExecutionEngine({
      db: opts.container.db,
      redactionEngine: opts.container.redactionEngine,
      logger: opts.container.logger,
    });

    this.executionEngine = executionEngine;
    this.runtime = new RuntimeAgent({
      deps: {
        opts,
        contextStore,
        sessionDal,
        fetchImpl,
        mcpManager,
        policyService,
        approvalDal,
      },
      defaultTenantId: DEFAULT_TENANT_ID,
      resolveDefaultAgentId: resolveAgentId,
      resolveDefaultWorkspaceId: () => resolveWorkspaceKey(),
      resolveHome: (nextAgentId) => opts.home ?? resolveAgentHome(resolveTyrumHome(), nextAgentId),
      executionPort: executionEngine,
      lifecycle: gatewayRuntimeLifecycle,
      onShutdown: async (context) => {
        await context.deps.mcpManager.shutdown();
      },
      tenantId: opts.tenantId,
      home,
      instanceOwner: opts.instanceOwner,
      agentId: opts.agentId,
      workspaceId: opts.workspaceId,
      languageModel: opts.languageModel,
      plugins: opts.plugins,
      maxSteps: opts.maxSteps,
      approvalWaitMs: opts.approvalWaitMs,
      approvalPollMs: opts.approvalPollMs,
      turnEngineWaitMs: opts.turnEngineWaitMs,
    });
  }

  setPlugins(plugins: PluginRegistry): void {
    this.runtime.setPlugins(plugins);
  }

  async shutdown(): Promise<void> {
    await this.runtime.shutdown();
  }

  async status(enabled: boolean): Promise<AgentStatusResponseT> {
    return await this.runtime.status(enabled);
  }

  async listRegisteredTools(): Promise<{
    allowlist: string[];
    tools: ToolDescriptor[];
    mcpServers: string[];
  }> {
    return await this.runtime.listRegisteredTools();
  }

  getLastContextReport(): AgentContextReport | undefined {
    return this.runtime.getLastContextReport();
  }

  get instanceOwner(): string {
    return this.runtime.instanceOwner;
  }

  get home(): string {
    return this.runtime.getContext().home;
  }

  get contextStore(): AgentContextStore {
    return this.runtime.getContext().deps.contextStore;
  }

  get sessionDal(): SessionDal {
    return this.runtime.getContext().deps.sessionDal;
  }

  get fetchImpl(): typeof fetch {
    return this.runtime.getContext().deps.fetchImpl;
  }

  get tenantId(): string {
    return this.runtime.getContext().tenantId;
  }

  get agentId(): string {
    return this.runtime.getContext().agentId;
  }

  get workspaceId(): string {
    return this.runtime.getContext().workspaceId;
  }

  get languageModelOverride() {
    return this.runtime.getContext().languageModelOverride;
  }

  get mcpManager(): McpManager {
    return this.runtime.getContext().deps.mcpManager;
  }

  get plugins(): PluginRegistry | undefined {
    return this.runtime.getContext().plugins;
  }

  get policyService(): PolicyService {
    return this.runtime.getContext().deps.policyService;
  }

  get approvalDal(): ApprovalDal {
    return this.runtime.getContext().deps.approvalDal;
  }

  get approvalWaitMs(): number {
    return this.runtime.getContext().approvalWaitMs;
  }

  get approvalPollMs(): number {
    return this.runtime.getContext().approvalPollMs;
  }

  get maxSteps(): number {
    return this.runtime.getContext().maxSteps;
  }

  get executionWorkerId(): string {
    return this.runtime.getContext().executionWorkerId;
  }

  get turnEngineWaitMs(): number {
    return this.runtime.getContext().turnEngineWaitMs;
  }

  get cleanupAtMs(): number {
    return this.runtime.getContext().cleanupAtMs;
  }

  set cleanupAtMs(value: number) {
    this.runtime.getContext().cleanupAtMs = value;
  }

  get defaultHeartbeatSeededScopes(): Set<string> {
    return this.runtime.getContext().defaultHeartbeatSeededScopes;
  }

  get prepareTurnDeps(): PrepareTurnDeps {
    return buildPrepareTurnDeps(this.runtime.getContext());
  }

  get turnDirectDeps(): TurnDirectDeps {
    return buildTurnDirectDeps(this.runtime.getContext());
  }

  async turnStream(input: AgentTurnRequestT): Promise<{
    streamResult: ReturnType<typeof streamText>;
    sessionId: string;
    guardianReviewDecisionCollector?: GuardianReviewDecisionCollectorResult;
    finalize: () => Promise<AgentTurnResponseT>;
  }> {
    return await this.runtime.turnStream(input);
  }

  async turn(input: AgentTurnRequestT): Promise<AgentTurnResponseT> {
    return await this.runtime.turn(input);
  }

  async compactSession(input: {
    sessionId: string;
    keepLastMessages?: number;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<SessionCompactionResult> {
    return await this.runtime.compactSession(input);
  }

  async executeDecideAction(
    input: AgentTurnRequestT,
    opts?: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: TurnExecutionContext },
  ): Promise<AgentTurnResponseT> {
    return await this.runtime.executeDecideAction(input, opts);
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
    return await this.runtime.executeGuardianReview(input, opts);
  }
}
