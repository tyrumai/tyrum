import type { AgentConfig as AgentConfigT } from "@tyrum/contracts";
import { resolveEmbeddingPipeline } from "./embedding-pipeline-resolution.js";
import type { AgentRuntimeOptions } from "./types.js";
import { loadAgentConfigOrDefault } from "../default-config.js";
import {
  MemorySemanticIndex,
  type MemorySemanticSearchHit,
} from "../../memory/memory-semantic-index.js";
import { ScheduleService } from "../../automation/schedule-service.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
import type { SecretProvider } from "../../secret/provider.js";
import type { ConversationDal } from "../conversation-dal.js";

export type PrepareTurnHelperDeps = {
  opts: AgentRuntimeOptions;
  instanceOwner: string;
  fetchImpl: typeof fetch;
  tenantId: string;
  secretProvider: SecretProvider | undefined;
  conversationDal: ConversationDal;
  defaultHeartbeatSeededScopes: Set<string>;
  cleanupAtMs: number;
  setCleanupAtMs: (ms: number) => void;
};

export async function semanticSearch(
  deps: PrepareTurnHelperDeps,
  query: string,
  limit: number,
  primaryModelId: string | null | undefined,
  conversationId: string,
  tenantId: string,
  agentId: string,
): Promise<MemorySemanticSearchHit[]> {
  try {
    const pipeline = await resolveEmbeddingPipeline({
      container: deps.opts.container,
      secretProvider: deps.secretProvider,
      instanceOwner: deps.instanceOwner,
      fetchImpl: deps.fetchImpl,
      primaryModelId,
      conversationId,
      tenantId,
      agentId,
    });
    if (!pipeline) return [];
    const index = new MemorySemanticIndex({
      db: deps.opts.container.db,
      tenantId,
      agentId,
      embedder: {
        modelId: "runtime/embedding",
        embed: async (text: string) => pipeline.embed(text),
      },
    });
    await index.ensureFresh();
    return await index.search(query, limit);
  } catch {
    // Intentional: semantic search is best-effort; fall back to no hits on failure.
    return [];
  }
}

export async function ensureDefaultHeartbeatSchedule(
  deps: PrepareTurnHelperDeps,
  agentId: string,
  workspaceId: string,
): Promise<void> {
  if (!deps.opts.container.deploymentConfig.automation.enabled) {
    return;
  }
  const scopeKey = `${deps.tenantId}:${agentId}:${workspaceId}`;
  if (deps.defaultHeartbeatSeededScopes.has(scopeKey)) {
    return;
  }

  const scheduleService = new ScheduleService(
    deps.opts.container.db,
    deps.opts.container.identityScopeDal,
  );
  await scheduleService.ensureDefaultHeartbeatScheduleForMembership({
    tenantId: deps.tenantId,
    agentId,
    workspaceId,
  });
  deps.defaultHeartbeatSeededScopes.add(scopeKey);
}

export function maybeCleanupConversations(
  deps: PrepareTurnHelperDeps,
  ttlDays: number,
  agentKey: string,
): void {
  const now = Date.now();
  if (now < deps.cleanupAtMs) {
    return;
  }
  void deps.conversationDal.deleteExpired(ttlDays, agentKey);
  deps.setCleanupAtMs(now + 60 * 60 * 1000);
}

export async function loadAgentConfigFromDb(
  deps: PrepareTurnHelperDeps,
  scope: { tenantId: string; agentId: string; agentKey: string },
): Promise<AgentConfigT> {
  return await loadAgentConfigOrDefault({
    db: deps.opts.container.db,
    stateMode: resolveGatewayStateMode(deps.opts.container.deploymentConfig),
    tenantId: scope.tenantId,
    agentId: scope.agentId,
  });
}
