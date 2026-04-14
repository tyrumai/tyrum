import {
  AgentStatusResponse,
  type AgentStatusResponse as AgentStatusResponseT,
} from "@tyrum/contracts";
import type { PluginRegistry } from "../../plugins/registry.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
import { loadAgentConfigOrDefault } from "../default-config.js";
import type { AgentContextStore } from "../context-store.js";
import { loadCurrentAgentContext } from "../load-context.js";
import { applyPersonaToIdentity, resolveAgentPersona } from "../persona.js";
import { type ToolDescriptor } from "../tools.js";
import { resolveEffectiveAgentConfig } from "../../extensions/defaults-dal.js";
import type { AgentRuntimeOptions } from "./types.js";
import type { McpManager } from "../mcp-manager.js";
import { resolveRuntimeToolDescriptorSource } from "./runtime-tool-descriptor-source.js";

export async function loadResolvedRuntimeContext(params: {
  opts: AgentRuntimeOptions;
  contextStore: AgentContextStore;
  tenantId: string;
  agentId: string;
  agentKey: string;
  workspaceId: string;
}) {
  const config = await loadAgentConfigOrDefault({
    db: params.opts.container.db,
    stateMode: resolveGatewayStateMode(params.opts.container.deploymentConfig),
    tenantId: params.tenantId,
    agentId: params.agentId,
  });
  const effectiveConfig = await resolveEffectiveAgentConfig({
    db: params.opts.container.db,
    tenantId: params.tenantId,
    config,
  });
  return await loadCurrentAgentContext({
    contextStore: params.contextStore,
    tenantId: params.tenantId,
    agentId: params.agentId,
    workspaceId: params.workspaceId,
    config: effectiveConfig,
  });
}

export async function listAvailableRuntimeTools(params: {
  opts: AgentRuntimeOptions;
  mcpManager: McpManager;
  loaded: Awaited<ReturnType<typeof loadResolvedRuntimeContext>>;
  plugins: PluginRegistry | undefined;
}): Promise<ToolDescriptor[]> {
  const stateMode = resolveGatewayStateMode(params.opts.container.deploymentConfig);
  const toolDescriptorSource = await resolveRuntimeToolDescriptorSource({
    ctx: params.loaded,
    mcpManager: params.mcpManager,
    plugins: params.plugins,
    stateMode,
  });
  return toolDescriptorSource.availableTools;
}

export function buildEnabledAgentStatus(params: {
  home: string;
  agentKey: string;
  loaded: Awaited<ReturnType<typeof loadResolvedRuntimeContext>>;
  availableTools: ToolDescriptor[];
}): AgentStatusResponseT {
  const persona = resolveAgentPersona({
    agentKey: params.agentKey,
    config: params.loaded.config,
    identity: params.loaded.identity,
  });
  const ctx = {
    ...params.loaded,
    identity: applyPersonaToIdentity(params.loaded.identity, persona),
  };
  return AgentStatusResponse.parse({
    enabled: true,
    home: params.home,
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
    tools: params.availableTools.map((tool) => tool.id),
    tool_access: ctx.config.tools,
    conversations: ctx.config.conversations,
  });
}

export function buildRegisteredToolsResult(params: {
  loaded: Awaited<ReturnType<typeof loadResolvedRuntimeContext>>;
  availableTools: ToolDescriptor[];
}) {
  return {
    allowlist: params.availableTools.map((tool) => tool.id),
    tools: params.availableTools.toSorted((left, right) => left.id.localeCompare(right.id)),
    mcpServers: params.loaded.mcpServers.map((server) => server.id),
  };
}
