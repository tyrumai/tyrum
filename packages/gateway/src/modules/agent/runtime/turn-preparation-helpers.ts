import type { AgentConfig as AgentConfigT } from "@tyrum/schemas";
import { resolveEmbeddingPipeline } from "./embedding-pipeline-resolution.js";
import type { AgentRuntimeOptions } from "./types.js";
import { ensureAgentConfigSeeded } from "../default-config.js";
import {
  MemoryV1SemanticIndex,
  type MemoryV1SemanticSearchHit,
} from "../../memory/v1-semantic-index.js";
import { ScheduleService } from "../../automation/schedule-service.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
import type { SecretProvider } from "../../secret/provider.js";
import type { SessionDal } from "../session-dal.js";

export type PrepareTurnHelperDeps = {
  opts: AgentRuntimeOptions;
  instanceOwner: string;
  fetchImpl: typeof fetch;
  tenantId: string;
  secretProvider: SecretProvider | undefined;
  sessionDal: SessionDal;
  defaultHeartbeatSeededScopes: Set<string>;
  cleanupAtMs: number;
  setCleanupAtMs: (ms: number) => void;
};

export async function semanticSearch(
  deps: PrepareTurnHelperDeps,
  query: string,
  limit: number,
  primaryModelId: string,
  sessionId: string,
  tenantId: string,
  agentId: string,
): Promise<MemoryV1SemanticSearchHit[]> {
  try {
    const pipeline = await resolveEmbeddingPipeline({
      container: deps.opts.container,
      secretProvider: deps.secretProvider,
      instanceOwner: deps.instanceOwner,
      fetchImpl: deps.fetchImpl,
      primaryModelId,
      sessionId,
      tenantId,
      agentId,
    });
    if (!pipeline) return [];
    const index = new MemoryV1SemanticIndex({
      db: deps.opts.container.db,
      tenantId,
      agentId,
      embedder: {
        modelId: "runtime/embedding",
        embed: async (text: string) => pipeline.embed(text),
      },
    });
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

export function maybeCleanupSessions(
  deps: PrepareTurnHelperDeps,
  ttlDays: number,
  agentKey: string,
): void {
  const now = Date.now();
  if (now < deps.cleanupAtMs) {
    return;
  }
  void deps.sessionDal.deleteExpired(ttlDays, agentKey);
  deps.setCleanupAtMs(now + 60 * 60 * 1000);
}

export async function loadAgentConfigFromDb(
  deps: PrepareTurnHelperDeps,
  scope: { tenantId: string; agentId: string; agentKey: string },
): Promise<AgentConfigT> {
  return (
    await ensureAgentConfigSeeded({
      db: deps.opts.container.db,
      stateMode: resolveGatewayStateMode(deps.opts.container.deploymentConfig),
      tenantId: scope.tenantId,
      agentId: scope.agentId,
      agentKey: scope.agentKey,
      createdBy: { kind: "agent-runtime" },
      reason: "seed",
    })
  ).config;
}
