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
import type { McpManager } from "../mcp-manager.js";
import type { SessionDal } from "../session-dal.js";
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
  SessionDal,
  McpManager,
  PluginRegistry,
  PolicyService,
  SecretProvider,
  ApprovalDal,
  ProtocolDeps
>;

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
