import { randomUUID } from "node:crypto";
import type {
  SubagentDescriptor,
  WorkItem,
  WorkScope,
  WorkSignal,
  WsEventEnvelope,
} from "@tyrum/contracts";
import type { WorkboardItemEventType, WorkboardTaskRow } from "@tyrum/runtime-workboard";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { SqlDb } from "../../statestore/types.js";
import { broadcastWsEvent } from "../../ws/broadcast.js";
import type { ProtocolDeps } from "../../ws/protocol/types.js";
import { WORKBOARD_WS_AUDIENCE } from "../../ws/workboard-audience.js";
import type { ApprovalDal } from "../approval/dal.js";
import { broadcastApprovalUpdated } from "../approval/update-broadcast.js";
import { LaneQueueSignalDal } from "../lanes/queue-signal-dal.js";
import type { RedactionEngine } from "../redaction/engine.js";
import { enqueueWorkItemStateChangeNotification } from "./notifications.js";
import type { WorkboardDal } from "./dal.js";

export async function loadTaskRows(
  db: SqlDb,
  scope: WorkScope,
  workItemId: string,
): Promise<WorkboardTaskRow[]> {
  return await db.all<WorkboardTaskRow>(
    `SELECT t.task_id, t.status, t.execution_profile, t.lease_owner, t.approval_id
     FROM work_item_tasks t
     JOIN work_items i ON i.tenant_id = t.tenant_id AND i.work_item_id = t.work_item_id
     WHERE i.tenant_id = ?
       AND i.agent_id = ?
       AND i.workspace_id = ?
       AND t.tenant_id = ?
       AND t.work_item_id = ?`,
    [scope.tenant_id, scope.agent_id, scope.workspace_id, scope.tenant_id, workItemId],
  );
}

export async function interruptSubagents(
  db: SqlDb,
  subagents: SubagentDescriptor[],
  detail: string,
  createdAtMs?: number,
): Promise<void> {
  const signals = new LaneQueueSignalDal(db);
  const signalCreatedAtMs = createdAtMs ?? Date.now();
  for (const subagent of subagents) {
    await signals.setSignal({
      tenant_id: subagent.tenant_id,
      key: subagent.conversation_key,
      lane: "subagent",
      kind: "interrupt",
      inbox_id: null,
      queue_mode: "interrupt",
      message_text: detail,
      created_at_ms: signalCreatedAtMs,
    });
  }
}

export async function clearSubagentSignals(
  db: SqlDb,
  subagents: SubagentDescriptor[],
): Promise<void> {
  const signals = new LaneQueueSignalDal(db);
  for (const subagent of subagents) {
    await signals.clearSignal({
      tenant_id: subagent.tenant_id,
      key: subagent.conversation_key,
      lane: "subagent",
    });
  }
}

export async function completePendingInterventionApprovals(params: {
  db: SqlDb;
  scope: WorkScope;
  workItemId: string;
  decision: "approved" | "denied";
  reason: string;
  approvalDal?: ApprovalDal;
  protocolDeps?: ProtocolDeps;
}): Promise<void> {
  if (!params.approvalDal) {
    return;
  }

  const approvalIds = await params.db.all<{ approval_id: string }>(
    `SELECT approval_id
     FROM approvals
     WHERE tenant_id = ?
       AND agent_id = ?
       AND workspace_id = ?
       AND work_item_id = ?
       AND kind = 'work.intervention'
       AND status IN ('queued', 'awaiting_human')`,
    [params.scope.tenant_id, params.scope.agent_id, params.scope.workspace_id, params.workItemId],
  );

  for (const row of approvalIds) {
    const transitioned = await params.approvalDal.transitionWithReview({
      tenantId: params.scope.tenant_id,
      approvalId: row.approval_id,
      status: params.decision === "approved" ? "approved" : "denied",
      reviewerKind: "system",
      reviewState: params.decision === "approved" ? "approved" : "denied",
      reason: params.reason,
      allowedCurrentStatuses: ["queued", "awaiting_human"],
    });
    if (transitioned?.transitioned && params.protocolDeps) {
      await broadcastApprovalUpdated({
        tenantId: params.scope.tenant_id,
        approval: transitioned.approval,
        protocolDeps: params.protocolDeps,
      });
    }
  }
}

export async function emitItemEvent(params: {
  db: SqlDb;
  redactionEngine?: RedactionEngine;
  protocolDeps?: ProtocolDeps;
  type: WorkboardItemEventType;
  item: WorkItem;
}): Promise<void> {
  const message = {
    event_id: randomUUID(),
    type: params.type,
    occurred_at: new Date().toISOString(),
    scope: { kind: "agent", agent_id: params.item.agent_id },
    payload: { item: params.item },
  } satisfies WsEventEnvelope;
  if (params.protocolDeps) {
    broadcastWsEvent(
      params.item.tenant_id,
      message,
      {
        connectionManager: params.protocolDeps.connectionManager,
        cluster: params.protocolDeps.cluster,
        logger: params.protocolDeps.logger,
        maxBufferedBytes: params.protocolDeps.maxBufferedBytes,
      },
      WORKBOARD_WS_AUDIENCE,
    );
    return;
  }
  const payload = {
    message,
    audience: WORKBOARD_WS_AUDIENCE,
  };
  const redactedPayload = params.redactionEngine
    ? params.redactionEngine.redactUnknown(payload).redacted
    : payload;
  await params.db.run(
    `INSERT INTO outbox (tenant_id, topic, target_edge_id, payload_json)
     VALUES (?, ?, ?, ?)`,
    [params.item.tenant_id, "ws.broadcast", null, JSON.stringify(redactedPayload)],
  );
}

export async function emitSignalEvent(params: {
  db: SqlDb;
  redactionEngine?: RedactionEngine;
  protocolDeps?: ProtocolDeps;
  type: "work.signal.updated";
  signal: WorkSignal;
}): Promise<void> {
  const message = {
    event_id: randomUUID(),
    type: params.type,
    occurred_at: new Date().toISOString(),
    scope: { kind: "agent", agent_id: params.signal.agent_id },
    payload: { signal: params.signal },
  } satisfies WsEventEnvelope;
  if (params.protocolDeps) {
    broadcastWsEvent(
      params.signal.tenant_id,
      message,
      {
        connectionManager: params.protocolDeps.connectionManager,
        cluster: params.protocolDeps.cluster,
        logger: params.protocolDeps.logger,
        maxBufferedBytes: params.protocolDeps.maxBufferedBytes,
      },
      WORKBOARD_WS_AUDIENCE,
    );
    return;
  }
  const payload = {
    message,
    audience: WORKBOARD_WS_AUDIENCE,
  };
  const redactedPayload = params.redactionEngine
    ? params.redactionEngine.redactUnknown(payload).redacted
    : payload;
  await params.db.run(
    `INSERT INTO outbox (tenant_id, topic, target_edge_id, payload_json)
     VALUES (?, ?, ?, ?)`,
    [params.signal.tenant_id, "ws.broadcast", null, JSON.stringify(redactedPayload)],
  );
}

export async function maybeEnqueueStateChangeNotification(params: {
  db: SqlDb;
  scope: WorkScope;
  item: WorkItem;
  approvalDal?: ApprovalDal;
  policyService?: PolicyService;
  protocolDeps?: ProtocolDeps;
}): Promise<void> {
  if (
    params.item.status !== "done" &&
    params.item.status !== "blocked" &&
    params.item.status !== "failed"
  ) {
    return;
  }
  await enqueueWorkItemStateChangeNotification({
    db: params.db,
    scope: params.scope,
    item: params.item,
    approvalDal: params.approvalDal,
    policyService: params.policyService,
    protocolDeps: params.protocolDeps,
  }).catch(() => undefined);
}

export async function loadDeleteEffects(params: {
  db: SqlDb;
  scope: WorkScope;
  workItemId: string;
}): Promise<{ childItemIds: string[]; attachedSignalIds: string[] }> {
  const [childRows, attachedSignalRows] = await Promise.all([
    params.db.all<{ work_item_id: string }>(
      `SELECT work_item_id
       FROM work_items
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND parent_work_item_id = ?`,
      [params.scope.tenant_id, params.scope.agent_id, params.scope.workspace_id, params.workItemId],
    ),
    params.db.all<{ signal_id: string }>(
      `SELECT signal_id
       FROM work_signals
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
         AND status IN ('active', 'paused')`,
      [params.scope.tenant_id, params.scope.agent_id, params.scope.workspace_id, params.workItemId],
    ),
  ]);

  return {
    childItemIds: childRows.map((row) => row.work_item_id),
    attachedSignalIds: attachedSignalRows.map((row) => row.signal_id),
  };
}

export async function emitDeleteEffects(params: {
  db: SqlDb;
  workboard: WorkboardDal;
  scope: WorkScope;
  childItemIds: string[];
  attachedSignalIds: string[];
  redactionEngine?: RedactionEngine;
  protocolDeps?: ProtocolDeps;
}): Promise<void> {
  for (const childItemId of params.childItemIds) {
    const child = await params.workboard.getItem({
      scope: params.scope,
      work_item_id: childItemId,
    });
    if (!child) {
      continue;
    }
    await emitItemEvent({
      db: params.db,
      redactionEngine: params.redactionEngine,
      protocolDeps: params.protocolDeps,
      type: "work.item.updated",
      item: child,
    });
  }

  for (const signalId of params.attachedSignalIds) {
    const signal = await params.workboard.getSignal({
      scope: params.scope,
      signal_id: signalId,
    });
    if (!signal) {
      continue;
    }
    await emitSignalEvent({
      db: params.db,
      redactionEngine: params.redactionEngine,
      protocolDeps: params.protocolDeps,
      type: "work.signal.updated",
      signal,
    });
  }
}

export async function createCapturedWorkItem(params: {
  workboard: WorkboardDal;
  db: SqlDb;
  redactionEngine?: RedactionEngine;
  protocolDeps?: ProtocolDeps;
  scope: WorkScope;
  item: Parameters<WorkboardDal["createItem"]>[0]["item"];
  createdFromConversationKey?: string;
  captureEvent?: {
    kind?: string;
    payload_json?: unknown;
  };
}): Promise<WorkItem> {
  const item = await params.workboard.createItem({
    scope: params.scope,
    item: params.item,
    createdFromConversationKey: params.createdFromConversationKey,
  });
  await params.workboard.createTask({
    scope: params.scope,
    task: {
      work_item_id: item.work_item_id,
      status: "queued",
      execution_profile: "planner",
      side_effect_class: "workspace",
      result_summary: "Initial refinement task",
    },
  });
  await params.workboard.setStateKv({
    scope: { kind: "work_item", ...params.scope, work_item_id: item.work_item_id },
    key: "work.refinement.phase",
    value_json: "new",
    provenance_json: { source: params.captureEvent?.kind ?? "work.create" },
  });
  await params.workboard.setStateKv({
    scope: { kind: "work_item", ...params.scope, work_item_id: item.work_item_id },
    key: "work.dispatch.phase",
    value_json: "unassigned",
    provenance_json: { source: params.captureEvent?.kind ?? "work.create" },
  });
  await params.workboard.appendEvent({
    scope: params.scope,
    work_item_id: item.work_item_id,
    kind: params.captureEvent?.kind ?? "work.capture",
    payload_json: params.captureEvent?.payload_json ?? {
      source: "work.create",
      created_from_conversation_key:
        params.item.created_from_conversation_key ?? params.createdFromConversationKey ?? null,
    },
  });
  await emitItemEvent({
    db: params.db,
    redactionEngine: params.redactionEngine,
    protocolDeps: params.protocolDeps,
    type: "work.item.created",
    item,
  });
  return item;
}
