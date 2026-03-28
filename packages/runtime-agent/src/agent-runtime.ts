import { randomUUID } from "node:crypto";
import type { LanguageModel } from "ai";
import type {
  AgentStatusResponse as AgentStatusResponseT,
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
} from "@tyrum/contracts";
import { AgentKey, WorkspaceKey } from "@tyrum/contracts";

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_APPROVAL_WAIT_MS = 120_000;
const DEFAULT_APPROVAL_POLL_MS = 500;
const MAX_TURN_ENGINE_WAIT_MS = 60_000;

export interface AgentRuntimeToolCatalog<TToolDescriptor> {
  allowlist: string[];
  tools: TToolDescriptor[];
  mcpServers: string[];
}

export interface AgentRuntimeTurnResult<TContextReport> {
  response: AgentTurnResponseT;
  contextReport?: TContextReport;
}

export interface AgentRuntimeTurnStreamHandle<
  TStreamResult,
  TContextReport,
  TGuardianReviewDecisionCollector,
> {
  streamResult: TStreamResult;
  conversationId: string;
  contextReport?: TContextReport;
  guardianReviewDecisionCollector?: TGuardianReviewDecisionCollector;
  finalize: () => Promise<AgentTurnResponseT>;
}

export interface AgentRuntimeGuardianReviewResult<
  TContextReport,
  TGuardianReviewDecision,
> extends AgentRuntimeTurnResult<TContextReport> {
  decision?: TGuardianReviewDecision;
  calls: number;
  invalidCalls: number;
  error?: string;
}

export interface AgentRuntimeContext<TDeps, TPlugins, TExecutionPort, TContextReport> {
  readonly deps: TDeps;
  readonly home: string;
  readonly tenantId: string;
  readonly agentId: string;
  readonly workspaceId: string;
  readonly instanceOwner: string;
  readonly languageModelOverride?: LanguageModel;
  readonly maxSteps: number;
  readonly approvalWaitMs: number;
  readonly approvalPollMs: number;
  readonly executionPort: TExecutionPort;
  readonly executionWorkerId: string;
  readonly turnEngineWaitMs: number;
  readonly defaultHeartbeatSeededScopes: Set<string>;
  plugins: TPlugins | undefined;
  lastContextReport: TContextReport | undefined;
  cleanupAtMs: number;
}

export interface AgentRuntimeLifecycle<
  TDeps,
  TPlugins,
  TExecutionPort,
  TContextReport,
  TToolDescriptor,
  TGuardianReviewDecision,
  TGuardianReviewDecisionCollector,
  TConversationCompactionResult,
  TStreamResult,
> {
  finalizeTurnLifecycle: (
    context: AgentRuntimeContext<TDeps, TPlugins, TExecutionPort, TContextReport>,
    input: {
      turnInput: AgentTurnRequestT;
      response: AgentTurnResponseT;
      contextReport?: TContextReport;
    },
  ) => Promise<AgentTurnResponseT>;
  status: (
    context: AgentRuntimeContext<TDeps, TPlugins, TExecutionPort, TContextReport>,
    enabled: boolean,
  ) => Promise<AgentStatusResponseT>;
  listRegisteredTools: (
    context: AgentRuntimeContext<TDeps, TPlugins, TExecutionPort, TContextReport>,
  ) => Promise<AgentRuntimeToolCatalog<TToolDescriptor>>;
  turn: (
    context: AgentRuntimeContext<TDeps, TPlugins, TExecutionPort, TContextReport>,
    input: AgentTurnRequestT,
  ) => Promise<AgentRuntimeTurnResult<TContextReport>>;
  turnStream: (
    context: AgentRuntimeContext<TDeps, TPlugins, TExecutionPort, TContextReport>,
    input: AgentTurnRequestT,
  ) => Promise<
    AgentRuntimeTurnStreamHandle<TStreamResult, TContextReport, TGuardianReviewDecisionCollector>
  >;
  compactConversation: (
    context: AgentRuntimeContext<TDeps, TPlugins, TExecutionPort, TContextReport>,
    input: {
      conversationId: string;
      keepLastMessages?: number;
      abortSignal?: AbortSignal;
      timeoutMs?: number;
    },
  ) => Promise<TConversationCompactionResult>;
  executeDecideAction: (
    context: AgentRuntimeContext<TDeps, TPlugins, TExecutionPort, TContextReport>,
    input: AgentTurnRequestT,
    opts?: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: unknown },
  ) => Promise<AgentRuntimeTurnResult<TContextReport>>;
  executeGuardianReview: (
    context: AgentRuntimeContext<TDeps, TPlugins, TExecutionPort, TContextReport>,
    input: AgentTurnRequestT,
    opts?: { abortSignal?: AbortSignal; timeoutMs?: number },
  ) => Promise<AgentRuntimeGuardianReviewResult<TContextReport, TGuardianReviewDecision>>;
}

export interface AgentRuntimeOptions<
  TDeps,
  TPlugins,
  TExecutionPort,
  TContextReport,
  TToolDescriptor,
  TGuardianReviewDecision,
  TGuardianReviewDecisionCollector,
  TConversationCompactionResult,
  TStreamResult,
> {
  deps: TDeps;
  defaultTenantId: string;
  resolveDefaultAgentId: () => string;
  resolveDefaultWorkspaceId: () => string;
  resolveHome: (agentId: string) => string;
  executionPort: TExecutionPort;
  lifecycle: AgentRuntimeLifecycle<
    TDeps,
    TPlugins,
    TExecutionPort,
    TContextReport,
    TToolDescriptor,
    TGuardianReviewDecision,
    TGuardianReviewDecisionCollector,
    TConversationCompactionResult,
    TStreamResult
  >;
  onShutdown: (
    context: AgentRuntimeContext<TDeps, TPlugins, TExecutionPort, TContextReport>,
  ) => Promise<void>;
  tenantId?: string;
  home?: string;
  instanceOwner?: string;
  agentId?: string;
  workspaceId?: string;
  languageModel?: LanguageModel;
  plugins?: TPlugins;
  maxSteps?: number;
  approvalWaitMs?: number;
  approvalPollMs?: number;
  turnEngineWaitMs?: number;
}

export class AgentRuntime<
  TDeps,
  TPlugins,
  TExecutionPort,
  TContextReport,
  TToolDescriptor,
  TGuardianReviewDecision,
  TGuardianReviewDecisionCollector,
  TConversationCompactionResult,
  TStreamResult,
> {
  private readonly context: AgentRuntimeContext<TDeps, TPlugins, TExecutionPort, TContextReport>;

  constructor(
    private readonly runtimeOptions: AgentRuntimeOptions<
      TDeps,
      TPlugins,
      TExecutionPort,
      TContextReport,
      TToolDescriptor,
      TGuardianReviewDecision,
      TGuardianReviewDecisionCollector,
      TConversationCompactionResult,
      TStreamResult
    >,
  ) {
    const opts = this.runtimeOptions;
    const agentIdCandidate = opts.agentId?.trim() || opts.resolveDefaultAgentId();
    const parsedAgentId = AgentKey.safeParse(agentIdCandidate);
    if (!parsedAgentId.success) {
      throw new Error(`invalid agent_id '${agentIdCandidate}' (${parsedAgentId.error.message})`);
    }
    const agentId = parsedAgentId.data;

    const workspaceIdCandidate = opts.workspaceId?.trim() || opts.resolveDefaultWorkspaceId();
    const parsedWorkspaceId = WorkspaceKey.safeParse(workspaceIdCandidate);
    if (!parsedWorkspaceId.success) {
      throw new Error(
        `invalid workspace_id '${workspaceIdCandidate}' (${parsedWorkspaceId.error.message})`,
      );
    }
    const workspaceId = parsedWorkspaceId.data;

    const configuredInstanceOwner = opts.instanceOwner?.trim();
    this.context = {
      deps: opts.deps,
      home: opts.home ?? opts.resolveHome(agentId),
      tenantId: opts.tenantId?.trim() || opts.defaultTenantId,
      agentId,
      workspaceId,
      instanceOwner: configuredInstanceOwner || `instance-${randomUUID()}`,
      languageModelOverride: opts.languageModel,
      maxSteps: opts.maxSteps ?? DEFAULT_MAX_STEPS,
      approvalWaitMs: Math.max(1_000, opts.approvalWaitMs ?? DEFAULT_APPROVAL_WAIT_MS),
      approvalPollMs: Math.max(100, opts.approvalPollMs ?? DEFAULT_APPROVAL_POLL_MS),
      executionPort: opts.executionPort,
      executionWorkerId: `agent-runtime-${agentId}-${randomUUID()}`,
      turnEngineWaitMs: Math.max(1, opts.turnEngineWaitMs ?? MAX_TURN_ENGINE_WAIT_MS),
      defaultHeartbeatSeededScopes: new Set<string>(),
      plugins: opts.plugins,
      lastContextReport: undefined,
      cleanupAtMs: 0,
    };
  }

  setPlugins(plugins: TPlugins): void {
    this.context.plugins = plugins;
  }

  async shutdown(): Promise<void> {
    await this.runtimeOptions.onShutdown(this.context);
  }

  async status(enabled: boolean): Promise<AgentStatusResponseT> {
    return await this.runtimeOptions.lifecycle.status(this.context, enabled);
  }

  async listRegisteredTools(): Promise<AgentRuntimeToolCatalog<TToolDescriptor>> {
    return await this.runtimeOptions.lifecycle.listRegisteredTools(this.context);
  }

  get deps(): TDeps {
    return this.context.deps;
  }

  get home(): string {
    return this.context.home;
  }

  get tenantId(): string {
    return this.context.tenantId;
  }

  get agentId(): string {
    return this.context.agentId;
  }

  get workspaceId(): string {
    return this.context.workspaceId;
  }

  getLastContextReport(): TContextReport | undefined {
    return this.context.lastContextReport;
  }

  get instanceOwner(): string {
    return this.context.instanceOwner;
  }

  get languageModelOverride(): LanguageModel | undefined {
    return this.context.languageModelOverride;
  }

  get maxSteps(): number {
    return this.context.maxSteps;
  }

  get approvalWaitMs(): number {
    return this.context.approvalWaitMs;
  }

  get approvalPollMs(): number {
    return this.context.approvalPollMs;
  }

  get executionPort(): TExecutionPort {
    return this.context.executionPort;
  }

  get executionWorkerId(): string {
    return this.context.executionWorkerId;
  }

  get turnEngineWaitMs(): number {
    return this.context.turnEngineWaitMs;
  }

  get defaultHeartbeatSeededScopes(): Set<string> {
    return this.context.defaultHeartbeatSeededScopes;
  }

  get plugins(): TPlugins | undefined {
    return this.context.plugins;
  }

  get cleanupAtMs(): number {
    return this.context.cleanupAtMs;
  }

  set cleanupAtMs(value: number) {
    this.context.cleanupAtMs = value;
  }

  getContext(): AgentRuntimeContext<TDeps, TPlugins, TExecutionPort, TContextReport> {
    return this.context;
  }

  async turnStream(input: AgentTurnRequestT): Promise<{
    streamResult: TStreamResult;
    conversationId: string;
    guardianReviewDecisionCollector?: TGuardianReviewDecisionCollector;
    finalize: () => Promise<AgentTurnResponseT>;
  }> {
    const result = await this.runtimeOptions.lifecycle.turnStream(this.context, input);
    if (result.contextReport !== undefined) {
      this.context.lastContextReport = result.contextReport;
    }

    return {
      streamResult: result.streamResult,
      conversationId: result.conversationId,
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
    const result = await this.runtimeOptions.lifecycle.turn(this.context, input);
    return await this.finalizeTurnLifecycle({
      turnInput: input,
      response: result.response,
      contextReport: result.contextReport,
    });
  }

  async compactConversation(input: {
    conversationId: string;
    keepLastMessages?: number;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<TConversationCompactionResult> {
    return await this.runtimeOptions.lifecycle.compactConversation(this.context, input);
  }

  async executeDecideAction(
    input: AgentTurnRequestT,
    opts?: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: unknown },
  ): Promise<AgentTurnResponseT> {
    const result = await this.runtimeOptions.lifecycle.executeDecideAction(
      this.context,
      input,
      opts,
    );
    return await this.finalizeTurnLifecycle({
      turnInput: input,
      response: result.response,
      contextReport: result.contextReport,
    });
  }

  async executeGuardianReview(
    input: AgentTurnRequestT,
    opts?: { abortSignal?: AbortSignal; timeoutMs?: number },
  ): Promise<{
    response: AgentTurnResponseT;
    decision?: TGuardianReviewDecision;
    calls: number;
    invalidCalls: number;
    error?: string;
  }> {
    const result = await this.runtimeOptions.lifecycle.executeGuardianReview(
      this.context,
      input,
      opts,
    );
    return {
      response: await this.finalizeTurnLifecycle({
        turnInput: input,
        response: result.response,
        contextReport: result.contextReport,
      }),
      decision: result.decision,
      calls: result.calls,
      invalidCalls: result.invalidCalls,
      error: result.error,
    };
  }

  private async finalizeTurnLifecycle(input: {
    turnInput: AgentTurnRequestT;
    response: AgentTurnResponseT;
    contextReport?: TContextReport;
  }): Promise<AgentTurnResponseT> {
    if (input.contextReport !== undefined) {
      this.context.lastContextReport = input.contextReport;
    }
    return await this.runtimeOptions.lifecycle.finalizeTurnLifecycle(this.context, input);
  }
}
