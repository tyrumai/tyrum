import type { LanguageModel } from "ai";
import type { ContextReport as ContextReportT } from "@tyrum/contracts";

export type AgentContextReport = ContextReportT;
export type AgentContextPartReport = ContextReportT["user_parts"][number];
export type AgentContextToolCallReport = ContextReportT["tool_calls"][number];
export type AgentContextPreTurnToolReport = ContextReportT["pre_turn_tools"][number];
export type AgentContextInjectedFileReport = ContextReportT["injected_files"][number];

export interface AgentLoadedContext<TConfig, TIdentity, TSkill, TMcpServer> {
  config: TConfig;
  identity: TIdentity;
  skills: TSkill[];
  mcpServers: TMcpServer[];
}

export interface AgentRuntimeAssemblyOptions<
  TContainer,
  TContextStore,
  TSessionDal,
  TMcpManager,
  TPlugins,
  TPolicyService,
  TSecretProvider,
  TApprovalDal,
  TProtocolDeps,
> {
  container: TContainer;
  /** Tenant identifier for DB scoping (default: default tenant). */
  tenantId?: string;
  home?: string;
  sessionDal?: TSessionDal;
  fetchImpl?: typeof fetch;
  /** Stable per-process instance owner identifier for OAuth leases and audit trails. */
  instanceOwner?: string;
  /** Stable agent identifier for routing/isolation (default: "default"). */
  agentId?: string;
  /** Workspace identifier for leases/audit (default: "default"). */
  workspaceId?: string;
  contextStore?: TContextStore;
  /** Override the language model (useful for testing). */
  languageModel?: LanguageModel;
  mcpManager?: TMcpManager;
  plugins?: TPlugins;
  /** Optional per-agent policy service instance. */
  policyService?: TPolicyService;
  /** Maximum tool/LLM steps per turn (AI SDK step budget). */
  maxSteps?: number;
  secretProvider?: TSecretProvider;
  approvalDal?: TApprovalDal;
  /** Optional protocol deps for dedicated node-backed dispatch. */
  protocolDeps?: TProtocolDeps;
  /** How long to wait for a human approval before expiring it. */
  approvalWaitMs?: number;
  /** Poll interval while waiting for human approval. */
  approvalPollMs?: number;
  /** Maximum duration for a single turn to complete via the execution engine. */
  turnEngineWaitMs?: number;
}
