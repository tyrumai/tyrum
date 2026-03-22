import type { WorkScope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import type { ProtocolDeps } from "../../ws/protocol/types.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { RedactionEngine } from "../redaction/engine.js";
import type { WorkboardDal } from "./dal.js";
import { teardownActiveExecution } from "./service-execution-teardown.js";
import {
  cancelPausedTasks,
  closePausedSubagents,
  completePendingInterventionApprovals,
  emitDeleteEffects,
  emitItemEvent,
  loadDeleteEffects,
} from "./service-support.js";

export async function deleteWorkItem(params: {
  db: SqlDb;
  workboard: WorkboardDal;
  redactionEngine?: RedactionEngine;
  approvalDal?: ApprovalDal;
  protocolDeps?: ProtocolDeps;
  scope: WorkScope;
  work_item_id: string;
}) {
  const occurredAtIso = new Date().toISOString();
  await teardownActiveExecution({
    db: params.db,
    scope: params.scope,
    workItemId: params.work_item_id,
    reason: "Deleted by operator.",
    workboard: params.workboard,
    occurredAtIso,
  });
  const { childItemIds, attachedSignalIds } = await loadDeleteEffects({
    db: params.db,
    scope: params.scope,
    workItemId: params.work_item_id,
  });
  await completePendingInterventionApprovals({
    db: params.db,
    scope: params.scope,
    workItemId: params.work_item_id,
    decision: "denied",
    reason: "Work deleted by operator.",
    approvalDal: params.approvalDal,
    protocolDeps: params.protocolDeps,
  });
  await closePausedSubagents({
    db: params.db,
    scope: params.scope,
    workItemId: params.work_item_id,
    reason: "Deleted by operator.",
    workboard: params.workboard,
    occurredAtIso,
  });
  await cancelPausedTasks({
    db: params.db,
    scope: params.scope,
    workItemId: params.work_item_id,
    detail: "Deleted by operator.",
    workboard: params.workboard,
    occurredAtIso,
  });
  for (const signalId of attachedSignalIds) {
    await params.workboard.updateSignal({
      scope: params.scope,
      signal_id: signalId,
      patch: { status: "cancelled" },
    });
  }
  const item = await params.workboard.deleteItem({
    scope: params.scope,
    work_item_id: params.work_item_id,
  });
  if (!item) {
    return undefined;
  }

  await emitDeleteEffects({
    db: params.db,
    workboard: params.workboard,
    scope: params.scope,
    childItemIds,
    attachedSignalIds,
    redactionEngine: params.redactionEngine,
    protocolDeps: params.protocolDeps,
  });
  await emitItemEvent({
    db: params.db,
    redactionEngine: params.redactionEngine,
    protocolDeps: params.protocolDeps,
    type: "work.item.deleted",
    item,
  });
  return item;
}
