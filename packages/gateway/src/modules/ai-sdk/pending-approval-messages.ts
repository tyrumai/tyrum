import type { TyrumUIMessage } from "@tyrum/contracts";
import { modelMessagesToChatMessages } from "./message-utils.js";
import { extractToolApprovalResumeState } from "../agent/runtime/turn-helpers.js";

function hasPendingApproval(messages: readonly TyrumUIMessage[]): boolean {
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

function injectApprovalRequest(input: {
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
    nextMessages[index] = {
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
    };
    return nextMessages;
  }

  return [
    ...input.messages,
    {
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
    },
  ];
}

export function loadPausedApprovalSnapshotMessages(
  approvalContext: unknown,
): TyrumUIMessage[] | undefined {
  const resumeState = extractToolApprovalResumeState(approvalContext);
  if (!resumeState) {
    return undefined;
  }

  const projectedSnapshot = modelMessagesToChatMessages(resumeState.messages).filter(
    (message) =>
      message.role === "assistant" || message.role === "system" || message.role === "user",
  );
  if (projectedSnapshot.length === 0) {
    return undefined;
  }

  return projectedSnapshot;
}

export function buildPendingApprovalMessages(input: {
  approvalContext: unknown;
  approvalId: string;
  toolInput: unknown;
  toolCallId: string;
  toolId: string;
}): TyrumUIMessage[] {
  const projectedSnapshot = loadPausedApprovalSnapshotMessages(input.approvalContext) ?? [];
  if (projectedSnapshot.length === 0) {
    return injectApprovalRequest({
      approvalId: input.approvalId,
      messages: [],
      minimumAssistantIndex: 0,
      toolInput: input.toolInput,
      toolCallId: input.toolCallId,
      toolId: input.toolId,
    });
  }
  if (hasPendingApproval(projectedSnapshot)) {
    return projectedSnapshot;
  }

  return injectApprovalRequest({
    approvalId: input.approvalId,
    messages: projectedSnapshot,
    minimumAssistantIndex: 0,
    toolInput: input.toolInput,
    toolCallId: input.toolCallId,
    toolId: input.toolId,
  });
}
