import type {
  ActionPrimitive,
  ExecutionBudgets,
  PolicyBundle as PolicyBundleT,
  WorkflowRunTrigger as WorkflowRunTriggerT,
} from "@tyrum/contracts";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { SqlDb } from "../../statestore/types.js";
import { loadScopedPolicySnapshot } from "../policy/scoped-snapshot.js";
import { createQueuedWorkflowRunFromActions } from "./create-queued-run.js";

export interface QueueScopedWorkflowRunFromActionsInput {
  db: SqlDb;
  transactionMode?: "wrap" | "reuse";
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
  policyService: PolicyService;
  playbookBundle?: PolicyBundleT;
  actions: ReadonlyArray<ActionPrimitive>;
}

export async function queueScopedWorkflowRunFromActions(
  input: QueueScopedWorkflowRunFromActionsInput,
): Promise<string> {
  const snapshot = await loadScopedPolicySnapshot(input.policyService, {
    tenantId: input.tenantId,
    agentId: input.agentId,
    playbookBundle: input.playbookBundle,
  });

  return await createQueuedWorkflowRunFromActions({
    db: input.db,
    transactionMode: input.transactionMode,
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
    policySnapshotId: snapshot.policy_snapshot_id,
    actions: input.actions,
  });
}
