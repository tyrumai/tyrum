import type {
  AgentTurnRequest as AgentTurnRequestT,
  NormalizedContainerKind,
} from "@tyrum/schemas";
import { parseChannelSourceKey } from "../../channels/interface.js";
import {
  ensureDefaultHeartbeatSchedule,
  loadAgentConfigFromDb,
  maybeCleanupSessions,
} from "./turn-preparation-helpers.js";
import { loadCurrentAgentContext } from "../load-context.js";
import { applyPersonaToIdentity, resolveAgentPersona } from "../persona.js";
import type { PrepareTurnDeps } from "./turn-preparation.js";
import type { ResolvedAgentTurnInput } from "./turn-helpers.js";

export async function resolveIdentityAndContext(
  deps: PrepareTurnDeps,
  input: AgentTurnRequestT,
  resolved: ResolvedAgentTurnInput,
) {
  const agentKey = input.agent_key?.trim() || deps.agentId;
  const workspaceKey = input.workspace_key?.trim() || deps.workspaceId;

  const agentId = await deps.opts.container.identityScopeDal.ensureAgentId(deps.tenantId, agentKey);
  const workspaceId = await deps.opts.container.identityScopeDal.ensureWorkspaceId(
    deps.tenantId,
    workspaceKey,
  );
  await deps.opts.container.identityScopeDal.ensureMembership(deps.tenantId, agentId, workspaceId);
  await ensureDefaultHeartbeatSchedule(deps, agentId, workspaceId);

  const config = await loadAgentConfigFromDb(deps, {
    tenantId: deps.tenantId,
    agentId,
    agentKey,
  });
  const loaded = await loadCurrentAgentContext({
    contextStore: deps.contextStore,
    tenantId: deps.tenantId,
    agentId,
    workspaceId,
    config,
  });
  const persona = resolveAgentPersona({
    agentKey,
    config: loaded.config,
    identity: loaded.identity,
  });
  const ctx = {
    ...loaded,
    identity: applyPersonaToIdentity(loaded.identity, persona),
  };
  maybeCleanupSessions(deps, ctx.config.sessions.ttl_days, agentKey);

  const containerKind: NormalizedContainerKind =
    input.container_kind ?? resolved.envelope?.container.kind ?? "channel";
  const parsedChannel = parseChannelSourceKey(resolved.channel);

  return {
    agentKey,
    workspaceKey,
    ctx,
    containerKind,
    connectorKey: parsedChannel.connector,
    accountKey: resolved.envelope?.delivery.account ?? parsedChannel.accountId,
  };
}
