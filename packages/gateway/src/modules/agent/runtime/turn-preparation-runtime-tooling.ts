import type { SessionRow } from "../session-dal.js";
import type { AgentLoadedContext } from "./types.js";
import type { ResolvedExecutionProfile } from "./intake-delegation.js";
import type { TurnPreparationRuntimeDeps } from "./turn-preparation-runtime.js";
import { ToolExecutor } from "../tool-executor.js";
import { NodeCapabilityInspectionService } from "../../node/capability-inspection-service.js";
import { listCapabilityCatalogEntries } from "../../node/capability-catalog.js";
import { createNodeDispatchServiceFromProtocolDeps } from "../../node/runtime-node-control-adapters.js";
import { AgentMemoryToolRuntime } from "../../memory/agent-tool-runtime.js";
import { resolveBuiltinMemoryConfig } from "../../memory/builtin-mcp.js";
import { resolveEmbeddingPipeline } from "./embedding-pipeline-resolution.js";
import { describeArtifactsForPrompt } from "./attachment-analysis.js";
import { resolveSessionModelDetailed } from "./session-model-resolution.js";
import { NodeInventoryService } from "@tyrum/runtime-node-control";

export async function createToolExecutorForTurnPreparation(input: {
  deps: TurnPreparationRuntimeDeps;
  ctx: AgentLoadedContext;
  session: SessionRow;
  executionProfile: ResolvedExecutionProfile;
  memoryProvenance?: {
    channel?: string;
    threadId?: string;
  };
}): Promise<ToolExecutor> {
  const mcpSpecMap = new Map<string, (typeof input.ctx.mcpServers)[number]>(
    input.ctx.mcpServers.map((server: (typeof input.ctx.mcpServers)[number]) => [
      server.id,
      server,
    ]),
  );
  const nodeDispatchService = input.deps.opts.protocolDeps
    ? createNodeDispatchServiceFromProtocolDeps(input.deps.opts.protocolDeps)
    : undefined;
  const nodeInventoryService = input.deps.opts.protocolDeps
    ? new NodeInventoryService({
        connectionManager: input.deps.opts.protocolDeps.connectionManager,
        connectionDirectory: input.deps.opts.protocolDeps.cluster?.connectionDirectory,
        nodePairingDal: input.deps.opts.container.nodePairingDal,
        presenceDal: input.deps.opts.container.presenceDal,
        attachmentDal: input.deps.opts.container.sessionLaneNodeAttachmentDal,
        capabilityCatalogEntries: listCapabilityCatalogEntries(),
      })
    : undefined;
  const nodeCapabilityInspectionService =
    input.deps.opts.protocolDeps && nodeInventoryService
      ? new NodeCapabilityInspectionService({
          connectionManager: input.deps.opts.protocolDeps.connectionManager,
          connectionDirectory: input.deps.opts.protocolDeps.cluster?.connectionDirectory,
          nodeInventoryService,
        })
      : undefined;

  const memoryConfig = resolveBuiltinMemoryConfig(input.ctx.config);
  const memoryToolRuntime = memoryConfig.enabled
    ? new AgentMemoryToolRuntime({
        db: input.deps.opts.container.db,
        dal: input.deps.opts.container.memoryDal,
        tenantId: input.session.tenant_id,
        agentId: input.session.agent_id,
        sessionId: input.session.session_id,
        channel: input.memoryProvenance?.channel,
        threadId: input.memoryProvenance?.threadId,
        config: memoryConfig,
        budgetsProvider: async () => memoryConfig.budgets,
        resolveEmbeddingPipeline: async () =>
          await resolveEmbeddingPipeline({
            container: input.deps.opts.container,
            secretProvider: input.deps.secretProvider,
            instanceOwner: input.deps.instanceOwner,
            fetchImpl: input.deps.fetchImpl,
            primaryModelId: input.executionProfile.profile.model_id ?? input.ctx.config.model.model,
            sessionId: input.session.session_id,
            tenantId: input.session.tenant_id,
            agentId: input.session.agent_id,
          }),
      })
    : undefined;
  const artifactDescribeRuntime = {
    describe: async (toolInput: {
      artifactIds: string[];
      prompt?: string;
      toolCallId: string;
    }): Promise<string> => {
      const helperModelConfig = input.deps.opts.container.deploymentConfig.attachments.helperModel;
      const { summary } = await describeArtifactsForPrompt({
        deps: {
          db: input.deps.opts.container.db,
          tenantId: input.session.tenant_id,
          fetchImpl: input.deps.fetchImpl,
          artifactStore: input.deps.opts.container.artifactStore,
          logger: input.deps.opts.container.logger,
          resolveModel: async () =>
            (
              await resolveSessionModelDetailed(
                {
                  container: input.deps.opts.container,
                  secretProvider: input.deps.secretProvider,
                  oauthLeaseOwner: input.deps.instanceOwner,
                  fetchImpl: input.deps.fetchImpl,
                },
                {
                  config:
                    helperModelConfig.model !== null
                      ? {
                          ...input.ctx.config,
                          model: helperModelConfig,
                        }
                      : input.ctx.config,
                  tenantId: input.session.tenant_id,
                  sessionId: input.session.session_id,
                  fetchImpl: input.deps.fetchImpl,
                },
              )
            ).model,
          maxAnalysisBytes: input.deps.opts.container.deploymentConfig.attachments.maxAnalysisBytes,
        },
        args: {
          artifact_ids: toolInput.artifactIds,
          ...(toolInput.prompt ? { prompt: toolInput.prompt } : {}),
        },
      });
      return summary;
    },
  };

  return new ToolExecutor(
    input.deps.home,
    input.deps.mcpManager,
    mcpSpecMap,
    input.deps.fetchImpl,
    input.deps.secretProvider,
    undefined,
    input.deps.opts.container.redactionEngine,
    input.deps.opts.container.secretResolutionAuditDal,
    {
      db: input.deps.opts.container.db,
      tenantId: input.session.tenant_id,
      agentId: input.session.agent_id,
      workspaceId: input.session.workspace_id,
      ownerPrefix: input.deps.instanceOwner,
    },
    nodeDispatchService,
    input.deps.opts.container.artifactStore,
    input.deps.opts.container.identityScopeDal,
    nodeInventoryService,
    nodeCapabilityInspectionService,
    input.deps.opts.protocolDeps?.connectionManager,
    input.deps.opts.protocolDeps?.cluster?.connectionDirectory,
    memoryToolRuntime,
    input.deps.opts.protocolDeps?.agents,
    input.deps.opts.protocolDeps,
    artifactDescribeRuntime,
    input.deps.opts.protocolDeps?.locationService,
    input.ctx.config.secret_refs,
  );
}
