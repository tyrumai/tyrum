import type { LanguageModel } from "ai";
import type {
  AgentConfig as AgentConfigT,
  IdentityPack as IdentityPackT,
  McpServerSpec as McpServerSpecT,
} from "@tyrum/schemas";
import type { GatewayContainer } from "../../../container.js";
import type { McpManager } from "../mcp-manager.js";
import type { SessionDal } from "../session-dal.js";
import type { LoadedSkillManifest } from "../workspace.js";
import type { AgentContextStore } from "../context-store.js";
import type { ApprovalDal } from "../../approval/dal.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "../../policy/service.js";
import type { SecretProvider } from "../../secret/provider.js";
import type { ProtocolDeps } from "../../../ws/protocol.js";

export interface AgentRuntimeOptions {
  container: GatewayContainer;
  /** Tenant identifier for DB scoping (default: default tenant). */
  tenantId?: string;
  home?: string;
  sessionDal?: SessionDal;
  fetchImpl?: typeof fetch;
  /** Stable per-process instance owner identifier for OAuth leases and audit trails. */
  instanceOwner?: string;
  /** Stable agent identifier for routing/isolation (default: "default"). */
  agentId?: string;
  /** Workspace identifier for leases/audit (default: "default"). */
  workspaceId?: string;
  contextStore?: AgentContextStore;
  /** Override the language model (useful for testing). */
  languageModel?: LanguageModel;
  mcpManager?: McpManager;
  plugins?: PluginRegistry;
  /** Optional per-agent policy service instance. */
  policyService?: PolicyService;
  /** Maximum tool/LLM steps per turn (AI SDK step budget). */
  maxSteps?: number;
  secretProvider?: SecretProvider;
  approvalDal?: ApprovalDal;
  /** Optional protocol deps for node dispatch (tool.node.dispatch). */
  protocolDeps?: ProtocolDeps;
  /** How long to wait for a human approval before expiring it. */
  approvalWaitMs?: number;
  /** Poll interval while waiting for human approval. */
  approvalPollMs?: number;
  /** Maximum duration for a single turn to complete via the execution engine. */
  turnEngineWaitMs?: number;
}

export interface AgentLoadedContext {
  config: AgentConfigT;
  identity: IdentityPackT;
  skills: LoadedSkillManifest[];
  mcpServers: McpServerSpecT[];
}

export interface AgentContextPartReport {
  id: string;
  chars: number;
}

export interface AgentContextToolCallReport {
  tool_call_id: string;
  tool_id: string;
  injected_chars: number;
}

export interface AgentContextPreTurnToolReport {
  tool_id: string;
  status: "succeeded" | "failed" | "skipped";
  injected_chars: number;
  error?: string;
}

export interface AgentContextInjectedFileReport {
  tool_call_id: string;
  path: string;
  offset?: number;
  limit?: number;
  raw_chars: number;
  selected_chars: number;
  injected_chars: number;
  truncated: boolean;
  truncation_marker?: string;
}

export interface AgentContextReport {
  context_report_id: string;
  generated_at: string;
  session_id: string;
  channel: string;
  thread_id: string;
  agent_id: string;
  workspace_id: string;
  execution_profile?: string;
  execution_profile_source?: string;
  system_prompt: {
    chars: number;
    sections: AgentContextPartReport[];
  };
  user_parts: AgentContextPartReport[];
  selected_tools: string[];
  tool_schema_top: AgentContextPartReport[];
  tool_schema_total_chars: number;
  enabled_skills: string[];
  mcp_servers: string[];
  memory: {
    keyword_hits: number;
    semantic_hits: number;
    structured_hits?: number;
    included_items?: number;
  };
  pre_turn_tools: AgentContextPreTurnToolReport[];
  tool_calls: AgentContextToolCallReport[];
  injected_files: AgentContextInjectedFileReport[];
}
