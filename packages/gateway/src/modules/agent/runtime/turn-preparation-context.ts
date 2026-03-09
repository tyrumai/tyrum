import type { AgentTurnRequest as AgentTurnRequestT, NormalizedContainerKind } from "@tyrum/schemas";
import {
  ensureDefaultHeartbeatSchedule,
  loadAgentConfigFromDb,
  maybeCleanupSessions,
  semanticSearch,
} from "./turn-preparation-helpers.js";
import { isStatusQuery, parseIntakeModeDecision, type ResolvedAgentTurnInput } from "./turn-helpers.js";
import type { ResolvedExecutionProfile } from "./intake-delegation.js";
import type { AgentLoadedContext } from "./types.js";
import type { TurnPreparationRuntimeDeps } from "./turn-preparation-runtime.js";
import type { SessionRow } from "../session-dal.js";
import { isToolAllowed, selectToolDirectory, type ToolDescriptor } from "../tools.js";
import { parseChannelSourceKey } from "../../channels/interface.js";
import { MemoryV1Dal } from "../../memory/v1-dal.js";
import { buildMemoryV1Digest } from "../../memory/v1-digest.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
import { applyPersonaToIdentity, resolveAgentPersona } from "../persona.js";
import { ToolSetBuilder } from "./tool-set-builder.js";
import { loadCurrentAgentContext } from "../load-context.js";

export async function resolveIdentityAndContext(
  deps: TurnPreparationRuntimeDeps,
  input: AgentTurnRequestT,
  resolved: ResolvedAgentTurnInput,
): Promise<{
  agentKey: string;
  workspaceKey: string;
  ctx: AgentLoadedContext;
  containerKind: NormalizedContainerKind;
  connectorKey: string;
  accountKey: string;
}> {
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

export async function resolveToolsAndMemory(
  deps: TurnPreparationRuntimeDeps,
  ctx: AgentLoadedContext,
  session: SessionRow,
  resolved: ResolvedAgentTurnInput,
  executionProfile: ResolvedExecutionProfile,
): Promise<{
  memoryDigestResult: {
    digest: string;
    included_item_ids: string[];
    keyword_hit_count: number;
    semantic_hit_count: number;
    structured_item_count: number;
  };
  toolSetBuilder: ToolSetBuilder;
  filteredTools: ToolDescriptor[];
}> {
  const wantsMcpTools = ctx.config.tools.allow.some(
    (entry) => entry === "*" || entry === "mcp*" || entry.startsWith("mcp."),
  );
  const memoryDigestPromise =
    isStatusQuery(resolved.message) || parseIntakeModeDecision(resolved.message)
      ? Promise.resolve({
          digest: "Skipped for command turns.",
          included_item_ids: [],
          keyword_hit_count: 0,
          semantic_hit_count: 0,
          structured_item_count: 0,
        })
      : buildMemoryDigest(deps, ctx, session, resolved);

  const [memoryDigestResult, mcpTools] = await Promise.all([
    memoryDigestPromise,
    wantsMcpTools
      ? deps.mcpManager.listToolDescriptors(ctx.mcpServers)
      : deps.mcpManager.listToolDescriptors([]),
  ]);
  const toolSetBuilder = new ToolSetBuilder({
    home: deps.home,
    stateMode: resolveGatewayStateMode(deps.opts.container.deploymentConfig),
    tenantId: session.tenant_id,
    agentId: session.agent_id,
    workspaceId: session.workspace_id,
    sessionDal: deps.sessionDal,
    wsEventDb: deps.opts.container.db,
    policyService: deps.policyService,
    approvalDal: deps.opts.container.approvalDal,
    approvalNotifier: deps.approvalNotifier as { notify: (approval: unknown) => void },
    approvalWaitMs: deps.approvalWaitMs,
    approvalPollMs: deps.approvalPollMs,
    logger: deps.opts.container.logger,
    secretProvider: deps.secretProvider,
    plugins: deps.plugins,
    redactionEngine: deps.opts.container.redactionEngine,
  });
  const pluginToolsRaw = deps.plugins?.getToolDescriptors() ?? [];
  const { allowlist: toolAllowlist, pluginTools } =
    await toolSetBuilder.resolvePolicyGatedPluginToolExposure({
      allowlist: ctx.config.tools.allow,
      pluginTools: pluginToolsRaw,
    });
  const toolCandidates = selectToolDirectory(
    resolved.message,
    toolAllowlist,
    [...mcpTools, ...pluginTools],
    Number.POSITIVE_INFINITY,
    true,
    resolveGatewayStateMode(deps.opts.container.deploymentConfig),
  );
  const filteredTools = toolCandidates
    .filter((tool) => isToolAllowed(executionProfile.profile.tool_allowlist, tool.id))
    .slice(0, 8);

  return { memoryDigestResult, toolSetBuilder, filteredTools };
}

async function buildMemoryDigest(
  deps: TurnPreparationRuntimeDeps,
  ctx: AgentLoadedContext,
  session: SessionRow,
  resolved: ResolvedAgentTurnInput,
): Promise<{
  digest: string;
  included_item_ids: string[];
  keyword_hit_count: number;
  semantic_hit_count: number;
  structured_item_count: number;
}> {
  try {
    return await buildMemoryV1Digest({
      dal: new MemoryV1Dal(deps.opts.container.db),
      tenantId: session.tenant_id,
      agentId: session.agent_id,
      query: resolved.message,
      config: ctx.config.memory.v1,
      semanticSearch: ctx.config.memory.v1.semantic.enabled
        ? (query, limit) =>
            semanticSearch(
              deps,
              query,
              limit,
              ctx.config.model.model,
              session.session_id,
              session.tenant_id,
              session.agent_id,
            )
        : undefined,
    });
  } catch (error) {
    deps.opts.container.logger.warn("memory.v1.digest_failed", {
      session_id: session.session_id,
      agent_id: session.agent_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      digest: "Memory digest unavailable.",
      included_item_ids: [],
      keyword_hit_count: 0,
      semantic_hit_count: 0,
      structured_item_count: 0,
    };
  }
}
