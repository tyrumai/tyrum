import type { WorkScope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import type { ProtocolDeps } from "../../ws/protocol/types.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { WorkboardDal } from "./dal.js";
import { teardownActiveExecution } from "./service-execution-teardown.js";
import {
  cancelPausedTasks,
  closePausedSubagents,
  completePendingInterventionApprovals,
} from "./service-support.js";

export async function cleanupOperatorStoppedWorkItem(params: {
  db: SqlDb;
  scope: WorkScope;
  workItemId: string;
  reason: string;
  occurredAtIso: string;
  workboard: WorkboardDal;
  approvalDal?: ApprovalDal;
  protocolDeps?: ProtocolDeps;
  approvalReason?: string;
  afterActiveExecutionTeardown?: () => Promise<void>;
}): Promise<void> {
  await teardownActiveExecution({
    db: params.db,
    scope: params.scope,
    workItemId: params.workItemId,
    reason: params.reason,
    workboard: params.workboard,
    occurredAtIso: params.occurredAtIso,
  });
  await params.afterActiveExecutionTeardown?.();
  await completePendingInterventionApprovals({
    db: params.db,
    scope: params.scope,
    workItemId: params.workItemId,
    decision: "denied",
    reason: params.approvalReason ?? params.reason,
    approvalDal: params.approvalDal,
    protocolDeps: params.protocolDeps,
  });
  await closePausedSubagents({
    db: params.db,
    scope: params.scope,
    workItemId: params.workItemId,
    reason: params.reason,
    workboard: params.workboard,
    occurredAtIso: params.occurredAtIso,
  });
  await cancelPausedTasks({
    db: params.db,
    scope: params.scope,
    workItemId: params.workItemId,
    detail: params.reason,
    workboard: params.workboard,
    occurredAtIso: params.occurredAtIso,
  });
}
