import type { UIMessage } from "ai";
import { modelMessagesToChatMessages } from "../../../modules/ai-sdk/message-utils.js";
import { extractToolApprovalResumeState } from "../../../modules/agent/runtime/turn-helpers.js";

export function loadPausedApprovalSnapshotMessages(
  approvalContext: unknown,
): UIMessage[] | undefined {
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

  return projectedSnapshot as unknown as UIMessage[];
}
