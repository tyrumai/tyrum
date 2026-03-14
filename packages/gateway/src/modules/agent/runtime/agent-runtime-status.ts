import {
  AgentStatusResponse,
  type AgentStatusResponse as AgentStatusResponseT,
} from "@tyrum/schemas";
import type { PluginRegistry } from "../../plugins/registry.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
import { materializeAllowedAgentIds } from "../access-config.js";
import { ensureAgentConfigSeeded } from "../default-config.js";
import type { AgentContextStore } from "../context-store.js";
import { loadCurrentAgentContext } from "../load-context.js";
import { applyPersonaToIdentity, resolveAgentPersona } from "../persona.js";
import {
  isBuiltinToolAvailableInStateMode,
  listBuiltinToolDescriptors,
  type ToolDescriptor,
} from "../tools.js";
import { resolveEffectiveAgentConfig } from "../../extensions/defaults-dal.js";
import type { AgentRuntimeOptions } from "./types.js";
import type { McpManager } from "../mcp-manager.js";

export async function loadResolvedRuntimeContext(params: {
  opts: AgentRuntimeOptions;
  contextStore: AgentContextStore;
  tenantId: string;
  agentId: string;
  agentKey: string;
  workspaceId: string;
}) {
  const config = await (
    await ensureAgentConfigSeeded({
      db: params.opts.container.db,
      stateMode: resolveGatewayStateMode(params.opts.container.deploymentConfig),
      tenantId: params.tenantId,
      agentId: params.agentId,
      agentKey: params.agentKey,
      createdBy: { kind: "agent-runtime" },
      reason: "seed",
    })
  ).config;
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
  mcpServers: Parameters<McpManager["listToolDescriptors"]>[0];
  plugins: PluginRegistry | undefined;
}): Promise<ToolDescriptor[]> {
  const stateMode = resolveGatewayStateMode(params.opts.container.deploymentConfig);
  const builtinTools = listBuiltinToolDescriptors();
  const builtinToolIds = new Set(builtinTools.map((tool) => tool.id));
  const mcpTools = await params.mcpManager.listToolDescriptors(params.mcpServers);
  const pluginTools = params.plugins?.getToolDescriptors() ?? [];
  return Array.from(
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
    tools: materializeAllowedAgentIds(ctx.config.tools, params.availableTools).map(
      (tool) => tool.id,
    ),
    tool_access: ctx.config.tools,
    sessions: ctx.config.sessions,
  });
}

export function buildRegisteredToolsResult(params: {
  loaded: Awaited<ReturnType<typeof loadResolvedRuntimeContext>>;
  availableTools: ToolDescriptor[];
}) {
  return {
    allowlist: materializeAllowedAgentIds(params.loaded.config.tools, params.availableTools).map(
      (tool) => tool.id,
    ),
    tools: params.availableTools.toSorted((left, right) => left.id.localeCompare(right.id)),
    mcpServers: params.loaded.mcpServers.map((server) => server.id),
  };
}
