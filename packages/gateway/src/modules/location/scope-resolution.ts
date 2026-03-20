import { ScopeNotFoundError, type IdentityScopeDal } from "../identity/scope.js";

export async function resolveExistingAgentIdOrThrow(input: {
  identityScopeDal: IdentityScopeDal;
  tenantId: string;
  agentKey: string;
}): Promise<string> {
  const agentId = await input.identityScopeDal.resolveAgentId(input.tenantId, input.agentKey);
  if (!agentId) {
    throw new ScopeNotFoundError(`agent '${input.agentKey}' not found`, {
      agent_key: input.agentKey,
    });
  }
  return agentId;
}

export async function resolveLocationAgentKey(input: {
  identityScopeDal: IdentityScopeDal;
  tenantId: string;
  agentKey?: string | null;
}): Promise<string> {
  const explicitAgentKey = input.agentKey?.trim();
  if (explicitAgentKey) {
    return explicitAgentKey;
  }
  const primaryAgentKey = await input.identityScopeDal.resolvePrimaryAgentKey(input.tenantId);
  if (!primaryAgentKey) {
    throw new Error("primary agent not found");
  }
  return primaryAgentKey;
}

export async function resolveExistingScopedIds(input: {
  identityScopeDal: IdentityScopeDal;
  tenantId: string;
  agentKey?: string;
  workspaceKey?: string;
  requireMembership?: boolean;
}): Promise<{ agentId?: string; workspaceId?: string }> {
  const agentKey = input.agentKey?.trim();
  const workspaceKey = input.workspaceKey?.trim();
  let agentId: string | undefined;
  let workspaceId: string | undefined;

  if (agentKey) {
    agentId = (await input.identityScopeDal.resolveAgentId(input.tenantId, agentKey)) ?? undefined;
    if (!agentId) {
      throw new ScopeNotFoundError(`agent '${agentKey}' not found`, {
        agent_key: agentKey,
      });
    }
  }

  if (workspaceKey) {
    workspaceId =
      (await input.identityScopeDal.resolveWorkspaceId(input.tenantId, workspaceKey)) ?? undefined;
    if (!workspaceId) {
      throw new ScopeNotFoundError(`workspace '${workspaceKey}' not found`, {
        workspace_key: workspaceKey,
      });
    }
  }

  if (input.requireMembership && agentId && workspaceId) {
    const hasMembership = await input.identityScopeDal.hasMembership(
      input.tenantId,
      agentId,
      workspaceId,
    );
    if (!hasMembership) {
      throw new ScopeNotFoundError("scope not found", {
        agent_key: agentKey,
        workspace_key: workspaceKey,
      });
    }
  }

  return { agentId, workspaceId };
}
