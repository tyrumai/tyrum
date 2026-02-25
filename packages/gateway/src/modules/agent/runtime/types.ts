import type { LanguageModel } from "ai";
import type { GatewayContainer } from "../../../container.js";
import type { McpManager } from "../mcp-manager.js";
import type { SessionDal } from "../session-dal.js";
import type { ApprovalNotifier } from "../../approval/notifier.js";
import type { ApprovalDal } from "../../approval/dal.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "../../policy/service.js";
import type { SecretProvider } from "../../secret/provider.js";

export interface AgentRuntimeOptions {
  container: GatewayContainer;
  home?: string;
  sessionDal?: SessionDal;
  fetchImpl?: typeof fetch;
  /** Stable agent identifier for routing/isolation (default: env TYRUM_AGENT_ID or "default"). */
  agentId?: string;
  /** Workspace identifier for leases/audit (default: env TYRUM_WORKSPACE_ID or "default"). */
  workspaceId?: string;
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
  approvalNotifier?: ApprovalNotifier;
  /** How long to wait for a human approval before expiring it. */
  approvalWaitMs?: number;
  /** Poll interval while waiting for human approval. */
  approvalPollMs?: number;
  /** Maximum duration for a single turn to complete via the execution engine. */
  turnEngineWaitMs?: number;
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
  };
  tool_calls: AgentContextToolCallReport[];
  injected_files: AgentContextInjectedFileReport[];
}
