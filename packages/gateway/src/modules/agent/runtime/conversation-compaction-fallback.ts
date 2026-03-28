import type { CheckpointSummary, TyrumUIMessage } from "@tyrum/contracts";
import { extractMessageText } from "./conversation-context-state.js";

function truncateSummaryLine(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 0) return "";
  if (maxLength <= 3) return "...".slice(0, maxLength);
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function uniqueNonEmpty(items: readonly string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = truncateSummaryLine(item);
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= limit) break;
  }
  return result;
}

function summarizeFallbackMessages(
  messages: readonly TyrumUIMessage[],
  role: TyrumUIMessage["role"],
  limit: number,
): string[] {
  return uniqueNonEmpty(
    messages
      .filter((message) => message.role === role)
      .map((message) => extractMessageText(message)),
    limit,
  );
}

export function buildDeterministicFallbackCheckpoint(input: {
  previousCheckpoint: CheckpointSummary | null;
  droppedMessages: readonly TyrumUIMessage[];
  criticalIdentifiers: readonly string[];
  relevantFiles: readonly string[];
}): CheckpointSummary {
  const previous = input.previousCheckpoint;
  const userMessages = summarizeFallbackMessages(input.droppedMessages, "user", 4);
  const assistantMessages = summarizeFallbackMessages(input.droppedMessages, "assistant", 6);
  const systemMessages = summarizeFallbackMessages(input.droppedMessages, "system", 2);
  const compactedHistory = uniqueNonEmpty(
    input.droppedMessages
      .map((message) => {
        const text = extractMessageText(message);
        if (text.length === 0) return "";
        return `${message.role}: ${text}`;
      })
      .filter((item) => item.length > 0),
    8,
  );
  const goal =
    truncateSummaryLine(previous?.goal ?? "") ||
    userMessages[0] ||
    assistantMessages[0] ||
    "Continue the conversation using the preserved recent messages.";
  const userConstraints = uniqueNonEmpty(
    [...(previous?.user_constraints ?? []), ...userMessages.slice(0, 3), ...systemMessages],
    8,
  );
  const discoveries = uniqueNonEmpty(
    [...(previous?.discoveries ?? []), ...assistantMessages, ...systemMessages],
    8,
  );
  const pendingWork = uniqueNonEmpty(
    [...(previous?.pending_work ?? []), ...userMessages.slice(-2), ...assistantMessages.slice(-2)],
    8,
  );
  const unresolvedQuestions = uniqueNonEmpty(previous?.unresolved_questions ?? [], 8);
  const completedWork = uniqueNonEmpty(previous?.completed_work ?? [], 8);
  const decisions = uniqueNonEmpty(previous?.decisions ?? [], 8);
  const criticalIdentifiers = uniqueNonEmpty(
    [...(previous?.critical_identifiers ?? []), ...input.criticalIdentifiers],
    20,
  );
  const relevantFiles = uniqueNonEmpty(
    [...(previous?.relevant_files ?? []), ...input.relevantFiles],
    20,
  );
  const handoffSections = [
    previous?.handoff_md?.trim() ?? "",
    compactedHistory.length > 0
      ? `Compacted history:\n${compactedHistory.map((item) => `- ${item}`).join("\n")}`
      : "",
    pendingWork.length > 0
      ? `Continue with:\n${pendingWork.map((item) => `- ${item}`).join("\n")}`
      : "",
  ].filter((section) => section.length > 0);

  return {
    goal,
    user_constraints: userConstraints,
    decisions,
    discoveries,
    completed_work: completedWork,
    pending_work: pendingWork,
    unresolved_questions: unresolvedQuestions,
    critical_identifiers: criticalIdentifiers,
    relevant_files: relevantFiles,
    handoff_md: handoffSections.join("\n\n"),
  };
}
