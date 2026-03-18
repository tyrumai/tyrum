import type { SessionRow } from "../session-dal.js";
import type { AgentLoadedContext } from "./types.js";
import type { ResolvedExecutionProfile } from "./intake-delegation.js";
import type { TurnPreparationRuntimeDeps } from "./turn-preparation-runtime.js";
import { ToolExecutor } from "../tool-executor.js";
import { NodeDispatchService } from "../node-dispatch-service.js";
import { NodeCapabilityInspectionService } from "../../node/capability-inspection-service.js";
import { NodeInventoryService } from "../../node/inventory-service.js";
import { AgentMemoryToolRuntime } from "../../memory/agent-tool-runtime.js";
import { resolveBuiltinMemoryConfig } from "../../memory/builtin-mcp.js";
import { resolveEmbeddingPipeline } from "./embedding-pipeline-resolution.js";

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
    ? new NodeDispatchService(input.deps.opts.protocolDeps)
    : undefined;
  const nodeInventoryService = input.deps.opts.protocolDeps
    ? new NodeInventoryService({
        connectionManager: input.deps.opts.protocolDeps.connectionManager,
        connectionDirectory: input.deps.opts.protocolDeps.cluster?.connectionDirectory,
        nodePairingDal: input.deps.opts.container.nodePairingDal,
        presenceDal: input.deps.opts.container.presenceDal,
        attachmentDal: input.deps.opts.container.sessionLaneNodeAttachmentDal,
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
  );
}
