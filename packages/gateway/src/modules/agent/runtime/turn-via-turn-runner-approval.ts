import { randomUUID } from "node:crypto";
import type { TyrumUIMessage } from "@tyrum/contracts";
import type { ApprovalDal } from "../../approval/dal.js";
import { buildPendingApprovalMessages } from "../../ai-sdk/pending-approval-messages.js";
import { coerceRecord } from "../../util/coerce.js";
import { TurnItemDal } from "../turn-item-dal.js";
import type { SqlDb } from "../../../statestore/types.js";
import { emitTurnItemCreatedTx } from "./turn-item-events.js";

export function approvalKeySuffix(context: unknown): string {
  const record = coerceRecord(context);
  const aiSdk = coerceRecord(record?.["ai_sdk"]);
  const approvalId = typeof aiSdk?.["approval_id"] === "string" ? aiSdk["approval_id"].trim() : "";
  return approvalId || randomUUID();
}

export function checkpointApprovalId(checkpoint: unknown): string | undefined {
  const record = coerceRecord(checkpoint);
  const approvalId =
    typeof record?.["resume_approval_id"] === "string" ? record["resume_approval_id"].trim() : "";
  return approvalId.length > 0 ? approvalId : undefined;
}

export function pauseReason(kind: string): string {
  if (kind === "budget") return "budget";
  if (kind === "policy") return "policy";
  return "approval";
}

export function normalizeLegacyExecutionScope(context: unknown): Record<string, unknown> {
  const record = coerceRecord(context);
  const normalized = record ? { ...record } : {};
  const approvalStepIndex = normalized["approval_step_index"];
  const executionStepId = normalized["execution_step_id"];

  if (
    typeof normalized["step_index"] !== "number" &&
    typeof approvalStepIndex === "number" &&
    Number.isFinite(approvalStepIndex)
  ) {
    normalized["step_index"] = approvalStepIndex;
  }

  if (
    typeof normalized["step_id"] !== "string" &&
    typeof executionStepId === "string" &&
    executionStepId.trim().length > 0
  ) {
    normalized["step_id"] = executionStepId;
  }

  return normalized;
}

function withTurnApprovalMetadata(
  message: TyrumUIMessage,
  input: {
    approvalId: string;
    createdAt: string;
    turnId: string;
  },
): TyrumUIMessage {
  return {
    ...message,
    metadata:
      typeof message.metadata === "object" && message.metadata !== null
        ? {
            ...(message.metadata as Record<string, unknown>),
            approval_id: input.approvalId,
            created_at: input.createdAt,
            turn_id: input.turnId,
          }
        : {
            approval_id: input.approvalId,
            created_at: input.createdAt,
            turn_id: input.turnId,
          },
  };
}

export async function persistApprovalTurnItem(input: {
  tx: SqlDb;
  tenantId: string;
  approval: Awaited<ReturnType<ApprovalDal["create"]>>;
  turnId: string;
}): Promise<void> {
  if (input.approval.turn_item_id) {
    return;
  }

  const context =
    input.approval.context && typeof input.approval.context === "object"
      ? (input.approval.context as Record<string, unknown>)
      : undefined;
  if (context?.["source"] !== "agent-tool-execution") {
    return;
  }

  const toolId = typeof context["tool_id"] === "string" ? context["tool_id"].trim() : "";
  const toolCallId =
    typeof context["tool_call_id"] === "string" ? context["tool_call_id"].trim() : "";
  if (!toolId || !toolCallId) {
    return;
  }

  const pendingMessages = buildPendingApprovalMessages({
    approvalContext: input.approval.context,
    approvalId: input.approval.approval_id,
    toolInput: context["args"],
    toolCallId,
    toolId,
  });
  const approvalMessage = pendingMessages.findLast((message) => message.role === "assistant");
  if (!approvalMessage) {
    return;
  }

  const turnItemDal = new TurnItemDal(input.tx);
  const existingItems = await turnItemDal.listByTurnId({
    tenantId: input.tenantId,
    turnId: input.turnId,
  });
  const highestExistingIndex = existingItems.reduce(
    (maxIndex, item) => Math.max(maxIndex, item.item_index),
    -1,
  );
  const turnItemId = randomUUID();
  const insertedTurnItem = await turnItemDal.ensureItemWithState({
    tenantId: input.tenantId,
    turnItemId,
    turnId: input.turnId,
    itemIndex: highestExistingIndex + 1,
    itemKey: `approval:${input.approval.approval_id}`,
    kind: "message",
    payload: {
      message: withTurnApprovalMetadata(approvalMessage, {
        approvalId: input.approval.approval_id,
        createdAt: input.approval.created_at,
        turnId: input.turnId,
      }),
    },
    createdAt: input.approval.created_at,
  });
  if (insertedTurnItem.inserted) {
    await emitTurnItemCreatedTx(input.tx, {
      tenantId: input.tenantId,
      turnItem: insertedTurnItem.item,
    });
  }
  await input.tx.run(
    `UPDATE approvals
       SET turn_item_id = COALESCE(turn_item_id, ?)
       WHERE tenant_id = ? AND approval_id = ?`,
    [turnItemId, input.tenantId, input.approval.approval_id],
  );
}
