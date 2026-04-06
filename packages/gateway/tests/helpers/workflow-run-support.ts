import type { GatewayContainer } from "../../src/container.js";
import type { StepExecutor } from "../../src/modules/execution/engine.js";
import { createQueuedWorkflowRunFromActions } from "../../src/modules/workflow-run/create-queued-run.js";
import { createWorkflowRunRunner } from "../../src/modules/workflow-run/create-runner.js";

export async function enqueueWorkflowRunForTest(
  container: GatewayContainer,
  input: {
    runKey: string;
    conversationKey?: string | null;
    planId: string;
    requestId: string;
    policySnapshotId?: string | null;
    actions: ReadonlyArray<unknown>;
  },
): Promise<string> {
  const scope = await container.identityScopeDal.resolveScopeIds();
  return await createQueuedWorkflowRunFromActions({
    db: container.db,
    tenantId: scope.tenantId,
    agentId: scope.agentId,
    workspaceId: scope.workspaceId,
    runKey: input.runKey,
    conversationKey: input.conversationKey ?? input.runKey,
    trigger: {
      kind: "manual",
      metadata: {
        source: "test",
        plan_id: input.planId,
      },
    },
    planId: input.planId,
    requestId: input.requestId,
    policySnapshotId: input.policySnapshotId ?? null,
    actions: input.actions,
  });
}

export async function tickWorkflowRunUntilSettled(
  container: GatewayContainer,
  input: {
    workflowRunId: string;
    executor: StepExecutor;
    workerId?: string;
    maxTicks?: number;
    terminalStatuses?: readonly string[];
  },
): Promise<string | undefined> {
  const workflowRunner = createWorkflowRunRunner(container);
  const workerId = input.workerId ?? "w1";
  const maxTicks = input.maxTicks ?? 10;
  const terminalStatuses = new Set(
    input.terminalStatuses ?? ["succeeded", "failed", "paused", "cancelled"],
  );

  for (let i = 0; i < maxTicks; i += 1) {
    await workflowRunner.workerTick({
      workerId,
      executor: input.executor,
      workflowRunId: input.workflowRunId,
    });
    const row = await container.db.get<{ status: string }>(
      "SELECT status FROM workflow_runs WHERE workflow_run_id = ?",
      [input.workflowRunId],
    );
    if (row?.status && terminalStatuses.has(row.status)) {
      return row.status;
    }
  }

  return (
    await container.db.get<{ status: string }>(
      "SELECT status FROM workflow_runs WHERE workflow_run_id = ?",
      [input.workflowRunId],
    )
  )?.status;
}
