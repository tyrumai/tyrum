import type { WorkScope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import type { ProtocolDeps } from "../../ws/protocol/types.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { RedactionEngine } from "../redaction/engine.js";
import type { WorkboardDal } from "./dal.js";
import { cleanupOperatorStoppedWorkItem } from "./service-operator-cleanup.js";
import { emitDeleteEffects, emitItemEvent, loadDeleteEffects } from "./service-support.js";

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
  let deleteEffects:
    | {
        childItemIds: string[];
        attachedSignalIds: string[];
      }
    | undefined;
  await cleanupOperatorStoppedWorkItem({
    db: params.db,
    scope: params.scope,
    workItemId: params.work_item_id,
    reason: "Deleted by operator.",
    approvalReason: "Work deleted by operator.",
    occurredAtIso,
    workboard: params.workboard,
    approvalDal: params.approvalDal,
    protocolDeps: params.protocolDeps,
    afterActiveExecutionTeardown: async () => {
      deleteEffects = await loadDeleteEffects({
        db: params.db,
        scope: params.scope,
        workItemId: params.work_item_id,
      });
    },
  });
  const { childItemIds, attachedSignalIds } = deleteEffects ?? {
    childItemIds: [],
    attachedSignalIds: [],
  };
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
