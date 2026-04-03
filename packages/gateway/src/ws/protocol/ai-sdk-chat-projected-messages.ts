import type { TyrumUIMessage } from "@tyrum/contracts";
import {
  appendWithoutDuplicateOverlap,
  messagesEqualIgnoringId,
} from "../../app/modules/ai-sdk/message-overlap.js";
import {
  hasPendingApprovalInMessages,
  injectPendingApprovalRequest,
  loadPausedApprovalSnapshotMessages,
} from "../../app/modules/ai-sdk/paused-approval-snapshot.js";
import { ApprovalDal, isApprovalBlockedStatus } from "../../app/modules/approval/dal.js";
import type { ProtocolDeps } from "./types.js";
import { canonicalizeUiMessage, canonicalizeUiMessages } from "./ai-sdk-chat-shared.js";

export async function findConversationKeysWithPausedApproval(input: {
  db: NonNullable<ProtocolDeps["db"]>;
  tenantId: string;
  conversationKeys: readonly string[];
}): Promise<Set<string>> {
  const conversationKeys = input.conversationKeys
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  if (conversationKeys.length === 0) {
    return new Set<string>();
  }

  const placeholders = conversationKeys.map(() => "?").join(", ");
  const rows = await input.db.all<{ conversation_key: string }>(
    `SELECT DISTINCT t.conversation_key
       FROM turns t
       JOIN approvals a
         ON a.tenant_id = t.tenant_id
        AND a.turn_id = t.turn_id
      WHERE t.tenant_id = ?
        AND t.conversation_key IN (${placeholders})
        AND t.status = 'paused'
        AND a.status IN ('queued', 'reviewing', 'awaiting_human')`,
    [input.tenantId, ...conversationKeys],
  );
  return new Set(
    rows
      .map((row) => row.conversation_key.trim())
      .filter((conversationKey) => conversationKey.length > 0),
  );
}

export async function projectConversationMessages(input: {
  approvalDal?: ProtocolDeps["approvalDal"];
  db: NonNullable<ProtocolDeps["db"]>;
  messages: TyrumUIMessage[];
  tenantId: string;
  conversationKey: string;
}): Promise<TyrumUIMessage[]> {
  const canonicalMessages = canonicalizeUiMessages(input.messages);
  if (hasPendingApprovalInMessages(canonicalMessages)) {
    return canonicalMessages;
  }

  const pausedKeys = await findConversationKeysWithPausedApproval({
    db: input.db,
    tenantId: input.tenantId,
    conversationKeys: [input.conversationKey],
  });
  if (!pausedKeys.has(input.conversationKey)) {
    return canonicalMessages;
  }

  const pausedTurn = await input.db.get<{ turn_id: string | null }>(
    `SELECT turn_id
       FROM turns
       WHERE tenant_id = ?
         AND conversation_key = ?
         AND status = 'paused'
       ORDER BY created_at DESC, turn_id DESC
       LIMIT 1`,
    [input.tenantId, input.conversationKey],
  );
  const turnId = pausedTurn?.turn_id?.trim();
  if (!turnId) {
    return canonicalMessages;
  }

  const approvalDal = input.approvalDal ?? new ApprovalDal(input.db);
  const approval = await approvalDal.getLatestByTurnId({
    tenantId: input.tenantId,
    turnId,
    statuses: ["queued", "reviewing", "awaiting_human"],
  });
  if (!approval || !isApprovalBlockedStatus(approval.status)) {
    return canonicalMessages;
  }

  const context =
    approval.context && typeof approval.context === "object"
      ? (approval.context as Record<string, unknown>)
      : undefined;
  if (context?.["source"] !== "agent-tool-execution") {
    return canonicalMessages;
  }

  const toolId = typeof context["tool_id"] === "string" ? context["tool_id"].trim() : "";
  const toolCallId =
    typeof context["tool_call_id"] === "string" ? context["tool_call_id"].trim() : "";
  if (!toolId || !toolCallId) {
    return canonicalMessages;
  }

  const projectedFromSnapshot = await projectPausedApprovalSnapshot({
    approvalContext: approval.context,
    approvalId: approval.approval_id,
    baseMessages: canonicalMessages,
    toolInput: context["args"],
    toolId,
    toolCallId,
  });
  if (projectedFromSnapshot) {
    return projectedFromSnapshot;
  }

  return [
    ...canonicalMessages,
    canonicalizeUiMessage({
      id: `approval-${approval.approval_id}`,
      role: "assistant",
      parts: [
        {
          type: `tool-${toolId}`,
          toolCallId,
          state: "approval-requested",
          input: context["args"],
          approval: { id: approval.approval_id },
        },
      ],
      metadata: {
        approval_id: approval.approval_id,
        created_at: approval.created_at,
      },
    }),
  ];
}

function countSharedPrefix(
  left: readonly TyrumUIMessage[],
  right: readonly TyrumUIMessage[],
): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && messagesEqualIgnoringId(left[index]!, right[index]!)) {
    index += 1;
  }
  return index;
}

async function projectPausedApprovalSnapshot(input: {
  approvalContext: unknown;
  approvalId: string;
  baseMessages: readonly TyrumUIMessage[];
  toolInput: unknown;
  toolCallId: string;
  toolId: string;
}): Promise<TyrumUIMessage[] | undefined> {
  const projectedSnapshot = canonicalizeUiMessages(
    loadPausedApprovalSnapshotMessages(input.approvalContext) ?? [],
  );
  if (projectedSnapshot.length === 0) {
    return undefined;
  }

  const sharedPrefix = countSharedPrefix(input.baseMessages, projectedSnapshot);
  const mergedMessages =
    sharedPrefix === input.baseMessages.length
      ? [...input.baseMessages, ...projectedSnapshot.slice(sharedPrefix)]
      : appendWithoutDuplicateOverlap(input.baseMessages, projectedSnapshot);
  if (mergedMessages.length === input.baseMessages.length) {
    return undefined;
  }
  if (hasPendingApprovalInMessages(mergedMessages)) {
    return canonicalizeUiMessages(mergedMessages);
  }

  return canonicalizeUiMessages(
    injectPendingApprovalRequest({
      approvalId: input.approvalId,
      messages: mergedMessages,
      minimumAssistantIndex: input.baseMessages.length,
      toolInput: input.toolInput,
      toolCallId: input.toolCallId,
      toolId: input.toolId,
    }),
  );
}
