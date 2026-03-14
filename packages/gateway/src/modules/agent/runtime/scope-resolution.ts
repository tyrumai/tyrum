import { ScopeNotFoundError, type IdentityScopeDal } from "../../identity/scope.js";

export async function resolveExistingRuntimeScopeIds(input: {
  identityScopeDal: IdentityScopeDal;
  tenantId: string;
  agentKey: string;
  workspaceKey: string;
}): Promise<{ agentId: string; workspaceId: string }> {
  const agentId = await input.identityScopeDal.resolveAgentId(input.tenantId, input.agentKey);
  if (!agentId) {
    throw new ScopeNotFoundError(`agent '${input.agentKey}' not found`, {
      agent_key: input.agentKey,
    });
  }

  const workspaceId = await input.identityScopeDal.resolveWorkspaceId(
    input.tenantId,
    input.workspaceKey,
  );
  if (!workspaceId) {
    throw new ScopeNotFoundError(`workspace '${input.workspaceKey}' not found`, {
      workspace_key: input.workspaceKey,
    });
  }

  const hasMembership = await input.identityScopeDal.hasMembership(
    input.tenantId,
    agentId,
    workspaceId,
  );
  if (!hasMembership) {
    throw new ScopeNotFoundError("scope not found", {
      agent_key: input.agentKey,
      workspace_key: input.workspaceKey,
    });
  }

  return { agentId, workspaceId };
}
