import { deriveAgentKeyFromKey } from "../modules/execution/gateway-step-executor-types.js";
import {
  ExecutionEngine,
  type StepExecutor as ExecutionStepExecutor,
} from "../modules/execution/engine.js";
import { createGatewayStepExecutor } from "../modules/execution/gateway-step-executor.js";
import { createKubernetesToolRunnerStepExecutor } from "../modules/execution/kubernetes-toolrunner-step-executor.js";
import { createNodeDispatchStepExecutor } from "../modules/execution/node-dispatch-step-executor.js";
import { createToolRunnerStepExecutor } from "../modules/execution/toolrunner-step-executor.js";
import { createNodeDispatchServiceFromProtocolDeps } from "../modules/node/runtime-node-control-adapters.js";
import { isPostgresDbUri } from "../statestore/db-uri.js";
import { resolveGatewayEntrypointPath } from "./entrypoint-path.js";
import { createExecutionEngine } from "./runtime-builders-engine.js";
import type { GatewayBootContext, ProtocolRuntime } from "./runtime-shared.js";

export function createWorkerExecutionEngine(context: GatewayBootContext): ExecutionEngine {
  return createExecutionEngine(context);
}

export function createWorkerExecutionExecutor(
  context: GatewayBootContext,
  protocol: ProtocolRuntime,
): ExecutionStepExecutor {
  const toolrunner = context.deploymentConfig.execution.toolrunner;
  if (toolrunner.launcher === "kubernetes") {
    if (!isPostgresDbUri(context.dbPath)) {
      throw new Error(
        "execution.toolrunner.launcher=kubernetes requires --db to be a Postgres URI",
      );
    }

    return createKubernetesToolRunnerStepExecutor({
      namespace: toolrunner.namespace,
      image: toolrunner.image,
      workspacePvcClaim: toolrunner.workspacePvcClaim,
      tyrumHome: context.tyrumHome,
      dbPath: context.dbPath,
      hardeningProfile: context.deploymentConfig.toolrunner.hardeningProfile,
      logger: context.logger,
      jobTtlSeconds: 300,
    });
  }

  const toolExecutor = createToolRunnerStepExecutor({
    entrypoint: resolveGatewayEntrypointPath(process.argv[1]),
    home: context.tyrumHome,
    dbPath: context.dbPath,
    migrationsDir: context.migrationsDir,
    logger: context.logger,
  }) satisfies ExecutionStepExecutor;
  const nodeDispatchExecutor = createNodeDispatchStepExecutor({
    db: context.container.db,
    artifactStore: context.container.artifactStore,
    nodeDispatchService: createNodeDispatchServiceFromProtocolDeps(protocol.protocolDeps),
    fallback: toolExecutor,
  }) satisfies ExecutionStepExecutor;
  const agents = protocol.protocolDeps.agents;

  return createGatewayStepExecutor({
    container: context.container,
    toolExecutor: nodeDispatchExecutor,
    decideExecutor: agents
      ? async ({ request, planId, stepIndex, timeoutMs, context: executionContext }) => {
          const runtime = await agents.getRuntime({
            tenantId: executionContext.tenantId,
            agentKey: deriveAgentKeyFromKey(executionContext.key),
          });
          const response = await runtime.executeDecideAction(request, {
            timeoutMs,
            execution: {
              planId,
              turnId: executionContext.turnId,
              stepIndex,
              stepId: executionContext.stepId,
              stepApprovalId: executionContext.approvalId ?? undefined,
            },
          });
          return { success: true, result: response };
        }
      : undefined,
  }) satisfies ExecutionStepExecutor;
}
