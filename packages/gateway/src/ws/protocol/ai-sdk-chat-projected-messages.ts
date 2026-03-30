import type { TyrumUIMessage } from "@tyrum/contracts";
import { loadPausedApprovalSnapshotMessages } from "../../app/modules/ai-sdk/paused-approval-snapshot.js";
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
       JOIN execution_steps s
         ON s.tenant_id = t.tenant_id
        AND s.turn_id = t.turn_id
      WHERE t.tenant_id = ?
        AND t.conversation_key IN (${placeholders})
        AND t.status = 'paused'
        AND s.status = 'paused'
        AND s.approval_id IS NOT NULL`,
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

  const pausedApproval = await input.db.get<{ approval_id: string | null }>(
    `SELECT s.approval_id
       FROM turns t
       JOIN execution_steps s
         ON s.tenant_id = t.tenant_id
        AND s.turn_id = t.turn_id
      WHERE t.tenant_id = ?
        AND t.conversation_key = ?
        AND t.status = 'paused'
        AND s.status = 'paused'
        AND s.approval_id IS NOT NULL
      ORDER BY t.created_at DESC, s.step_index ASC
      LIMIT 1`,
    [input.tenantId, input.conversationKey],
  );
  const approvalId = pausedApproval?.approval_id?.trim();
  if (!approvalId) {
    return canonicalMessages;
  }

  const approvalDal = input.approvalDal ?? new ApprovalDal(input.db);
  const approval = await approvalDal.getById({
    tenantId: input.tenantId,
    approvalId,
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

function messagesEqualIgnoringId(left: TyrumUIMessage, right: TyrumUIMessage): boolean {
  return left.role === right.role && JSON.stringify(left.parts) === JSON.stringify(right.parts);
}

function appendWithoutDuplicateOverlap(
  existing: readonly TyrumUIMessage[],
  appended: readonly TyrumUIMessage[],
): TyrumUIMessage[] {
  const maxOverlap = Math.min(existing.length, appended.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      const left = existing[existing.length - overlap + index];
      const right = appended[index];
      if (!left || !right || !messagesEqualIgnoringId(left, right)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return [...existing, ...appended.slice(overlap)];
    }
  }
  return [...existing, ...appended];
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

function injectApprovalRequestIntoProjectedMessages(input: {
  approvalId: string;
  messages: readonly TyrumUIMessage[];
  minimumAssistantIndex: number;
  toolInput: unknown;
  toolCallId: string;
  toolId: string;
}): TyrumUIMessage[] {
  for (let index = input.messages.length - 1; index >= input.minimumAssistantIndex; index -= 1) {
    const message = input.messages[index];
    if (!message || message.role !== "assistant") {
      continue;
    }
    const nextMessages = input.messages.slice();
    nextMessages[index] = canonicalizeUiMessage({
      ...message,
      parts: [
        ...message.parts,
        {
          type: `tool-${input.toolId}`,
          toolCallId: input.toolCallId,
          state: "approval-requested",
          input: input.toolInput,
          approval: { id: input.approvalId },
        },
      ],
      metadata:
        typeof message.metadata === "object" && message.metadata !== null
          ? { ...(message.metadata as Record<string, unknown>), approval_id: input.approvalId }
          : { approval_id: input.approvalId },
    });
    return nextMessages;
  }

  return [
    ...input.messages,
    canonicalizeUiMessage({
      id: `approval-${input.approvalId}`,
      role: "assistant",
      parts: [
        {
          type: `tool-${input.toolId}`,
          toolCallId: input.toolCallId,
          state: "approval-requested",
          input: input.toolInput,
          approval: { id: input.approvalId },
        },
      ],
      metadata: { approval_id: input.approvalId },
    }),
  ];
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
    (loadPausedApprovalSnapshotMessages(input.approvalContext) ??
      []) as unknown as TyrumUIMessage[],
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
    injectApprovalRequestIntoProjectedMessages({
      approvalId: input.approvalId,
      messages: mergedMessages,
      minimumAssistantIndex: input.baseMessages.length,
      toolInput: input.toolInput,
      toolCallId: input.toolCallId,
      toolId: input.toolId,
    }),
  );
}

function hasPendingApprovalInMessages(messages: readonly TyrumUIMessage[]): boolean {
  return messages.some((message) =>
    message.parts.some((part) => {
      if (part.type === "data-approval-state" && "data" in part) {
        const data =
          part.data && typeof part.data === "object"
            ? (part.data as Record<string, unknown>)
            : null;
        return data?.["state"] === "pending";
      }
      return (
        (part.type === "dynamic-tool" || part.type.startsWith("tool-")) &&
        "state" in part &&
        part.state === "approval-requested"
      );
    }),
  );
}
