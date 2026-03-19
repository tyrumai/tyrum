import type { AgentConfig as AgentConfigT } from "@tyrum/contracts";
import type { AgentContextScope, AgentContextStore } from "./context-store.js";
import type { AgentLoadedContext } from "./runtime/types.js";

export async function loadAgentContext(params: {
  contextStore: AgentContextStore;
  scope: AgentContextScope;
  config: AgentConfigT;
}): Promise<AgentLoadedContext> {
  await params.contextStore.ensureAgentContext(params.scope);
  const identity = await params.contextStore.getIdentity(params.scope);
  const skills = await params.contextStore.getEnabledSkills(params.scope, params.config);
  const mcpServers = await params.contextStore.getEnabledMcpServers(params.scope, params.config);

  return {
    config: params.config,
    identity,
    skills,
    mcpServers,
  };
}

export async function loadCurrentAgentContext(params: {
  contextStore: AgentContextStore;
  tenantId: string;
  agentId: string;
  workspaceId: string;
  config: AgentConfigT;
}): Promise<AgentLoadedContext> {
  return await loadAgentContext({
    contextStore: params.contextStore,
    scope: {
      tenantId: params.tenantId,
      agentId: params.agentId,
      workspaceId: params.workspaceId,
    },
    config: params.config,
  });
}
