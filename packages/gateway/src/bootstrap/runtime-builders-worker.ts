import { deriveAgentKeyFromKey } from "../modules/execution/gateway-step-executor-types.js";
import type { ExecutionWorkerEngine } from "@tyrum/runtime-execution";
import type { StepExecutor as ExecutionStepExecutor } from "../modules/execution/engine.js";
import { createGatewayStepExecutor } from "../modules/execution/gateway-step-executor.js";
import { createKubernetesToolRunnerStepExecutor } from "../modules/execution/kubernetes-toolrunner-step-executor.js";
import { createNodeDispatchStepExecutor } from "../modules/execution/node-dispatch-step-executor.js";
import { createToolRunnerStepExecutor } from "../modules/execution/toolrunner-step-executor.js";
import type { TurnController } from "../modules/agent/runtime/turn-controller.js";
import { NATIVE_TURN_RUNNER_INPUT_MARKER_PATTERN } from "../modules/agent/runtime/turn-runner-native-marker.js";
import { createNodeDispatchServiceFromProtocolDeps } from "../modules/node/runtime-node-control-adapters.js";
import type { WorkflowRunRunner } from "../modules/workflow-run/runner.js";
import { isPostgresDbUri } from "../statestore/db-uri.js";
import type { SqlDb } from "../statestore/types.js";
import { resolveGatewayEntrypointPath } from "./entrypoint-path.js";
import type { GatewayBootContext, ProtocolRuntime } from "./runtime-shared.js";

export async function cancelLegacyConversationTurns(input: {
  db: Pick<SqlDb, "all">;
  turnController: TurnController;
  logger?: Pick<GatewayBootContext["logger"], "warn">;
}): Promise<number> {
  const rows = await input.db.all<{ turn_id: string }>(
    `SELECT r.turn_id
       FROM turns r
       JOIN turn_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
      WHERE r.status IN ('queued', 'running', 'paused')
        AND j.trigger_json LIKE '%"kind":"conversation"%'
        AND j.input_json NOT LIKE ?`,
    [NATIVE_TURN_RUNNER_INPUT_MARKER_PATTERN],
  );
  let cancelled = 0;
  for (const row of rows) {
    const outcome = await input.turnController.cancelTurn(
      row.turn_id,
      "legacy execution turns are no longer supported",
    );
    if (outcome === "cancelled") {
      cancelled += 1;
    }
  }
  if (cancelled > 0) {
    input.logger?.warn("execution.legacy_conversation_turns_cancelled", {
      count: cancelled,
    });
  }
  return cancelled;
}

export function createWorkerLoopEngine(input: {
  workflowRunner?: WorkflowRunRunner;
}): ExecutionWorkerEngine {
  const workflowRunner = input.workflowRunner;

  return {
    workerTick: async (tickInput) => {
      if (!workflowRunner) {
        return false;
      }
      const workedWorkflowRun = await workflowRunner.workerTick({
        ...tickInput,
        workflowRunId: tickInput.turnId,
      });
      return workedWorkflowRun;
    },
  };
}

export function createWorkerExecutionExecutor(
  context: GatewayBootContext,
  protocol: ProtocolRuntime,
): ExecutionStepExecutor {
  const toolrunner = context.deploymentConfig.execution.toolrunner;
  const toolExecutor =
    toolrunner.launcher === "kubernetes"
      ? createKubernetesExecutionToolExecutor(context, toolrunner)
      : (createToolRunnerStepExecutor({
          entrypoint: resolveGatewayEntrypointPath(process.argv[1]),
          home: context.tyrumHome,
          dbPath: context.dbPath,
          migrationsDir: context.migrationsDir,
          logger: context.logger,
        }) satisfies ExecutionStepExecutor);
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

function createKubernetesExecutionToolExecutor(
  context: GatewayBootContext,
  toolrunner: Extract<
    GatewayBootContext["deploymentConfig"]["execution"]["toolrunner"],
    { launcher: "kubernetes" }
  >,
): ExecutionStepExecutor {
  if (!isPostgresDbUri(context.dbPath)) {
    throw new Error("execution.toolrunner.launcher=kubernetes requires --db to be a Postgres URI");
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
