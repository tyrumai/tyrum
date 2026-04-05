import { randomUUID } from "node:crypto";
import type { ExecutionBudgets, WorkflowRunTrigger as WorkflowRunTriggerT } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { WorkflowRunDal } from "./dal.js";

export interface CreateQueuedWorkflowRunFromActionsInput {
  db?: SqlDb;
  workflowRunDal?: WorkflowRunDal;
  transactionMode?: "wrap" | "reuse";
  workflowRunId?: string;
  tenantId: string;
  agentId: string;
  workspaceId: string;
  runKey: string;
  conversationKey?: string | null;
  trigger: WorkflowRunTriggerT;
  planId?: string | null;
  requestId?: string | null;
  input?: unknown;
  budgets?: ExecutionBudgets;
  policySnapshotId?: string | null;
  actions: ReadonlyArray<unknown>;
}

function resolveWorkflowRunDal(input: CreateQueuedWorkflowRunFromActionsInput): WorkflowRunDal {
  if (input.workflowRunDal) {
    return input.workflowRunDal;
  }
  if (input.db) {
    return new WorkflowRunDal(input.db);
  }
  throw new Error("workflow run persistence requires db access");
}

export async function createQueuedWorkflowRunFromActions(
  input: CreateQueuedWorkflowRunFromActionsInput,
): Promise<string> {
  const workflowRunId = input.workflowRunId?.trim() || randomUUID();
  const workflowRunDal = resolveWorkflowRunDal(input);
  const persistRun =
    input.transactionMode === "reuse"
      ? workflowRunDal.createRunWithStepsTx.bind(workflowRunDal)
      : workflowRunDal.createRunWithSteps.bind(workflowRunDal);
  await persistRun({
    run: {
      workflowRunId,
      tenantId: input.tenantId,
      agentId: input.agentId,
      workspaceId: input.workspaceId,
      runKey: input.runKey,
      conversationKey: input.conversationKey,
      trigger: input.trigger,
      planId: input.planId,
      requestId: input.requestId,
      input: input.input,
      budgets: input.budgets,
      policySnapshotId: input.policySnapshotId,
    },
    steps: input.actions.map((action) => ({
      action,
      policySnapshotId: input.policySnapshotId,
    })),
  });
  return workflowRunId;
}
