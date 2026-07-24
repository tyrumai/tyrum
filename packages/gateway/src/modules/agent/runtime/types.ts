import type {
  AgentConfig as AgentConfigT,
  IdentityPack as IdentityPackT,
  McpServerSpec as McpServerSpecT,
} from "@tyrum/contracts";
import type {
  AgentContextInjectedFileReport,
  AgentContextPartReport,
  AgentContextPreTurnToolReport,
  AgentContextReport,
  AgentContextToolCallReport,
  AgentLoadedContext as RuntimeAgentLoadedContext,
  AgentRuntimeAssemblyOptions,
} from "@tyrum/runtime-agent";
import type { GatewayContainer } from "../../../container.js";
import type { HarnessExecutionBackends } from "../execution-backend.js";
import type { McpManager } from "../mcp-manager.js";
import type { ConversationDal } from "../conversation-dal.js";
import type { LoadedSkillManifest } from "../workspace.js";
import type { AgentContextStore } from "../context-store.js";
import type { ApprovalDal } from "../../approval/dal.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { SecretProvider } from "../../secret/provider.js";
import type { ProtocolDeps } from "../../../ws/protocol.js";

export type AgentRuntimeOptions = AgentRuntimeAssemblyOptions<
  GatewayContainer,
  AgentContextStore,
  ConversationDal,
  McpManager,
  PluginRegistry,
  PolicyService,
  SecretProvider,
  ApprovalDal,
  ProtocolDeps
> & {
  /**
   * Overrides the harness backends this runtime routes flagged conversations
   * to. Left unset in production, where the runtime assembles its own lazy
   * registry from the container; supplied by tests that need a seam.
   */
  harnessBackends?: HarnessExecutionBackends;
};

export type AgentLoadedContext = RuntimeAgentLoadedContext<
  AgentConfigT,
  IdentityPackT,
  LoadedSkillManifest,
  McpServerSpecT
>;

export type {
  AgentContextInjectedFileReport,
  AgentContextPartReport,
  AgentContextPreTurnToolReport,
  AgentContextReport,
  AgentContextToolCallReport,
};
