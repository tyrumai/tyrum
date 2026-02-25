import { pruneMessages } from "ai";
import type { ModelMessage } from "ai";

const DEFAULT_CONTEXT_MAX_MESSAGES = 32;
const DEFAULT_CONTEXT_TOOL_PRUNE_KEEP_LAST_MESSAGES = 4;

export function parseNonnegativeInt(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^[0-9]+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) return undefined;
  return parsed;
}

function resolveContextMaxMessages(): number {
  const parsed = parseNonnegativeInt(process.env["TYRUM_CONTEXT_MAX_MESSAGES"]);
  return Math.max(8, parsed ?? DEFAULT_CONTEXT_MAX_MESSAGES);
}

function resolveToolPruneKeepLastMessages(): number {
  const parsed = parseNonnegativeInt(process.env["TYRUM_CONTEXT_TOOL_PRUNE_KEEP_LAST_MESSAGES"]);
  return Math.max(2, parsed ?? DEFAULT_CONTEXT_TOOL_PRUNE_KEEP_LAST_MESSAGES);
}

export function applyDeterministicContextCompactionAndToolPruning(
  messages: ModelMessage[],
): ModelMessage[] {
  const maxMessages = resolveContextMaxMessages();
  const keepLastToolMessages = Math.min(
    resolveToolPruneKeepLastMessages(),
    Math.max(2, maxMessages - 1),
  );

  const toolCalls =
    `before-last-${keepLastToolMessages}-messages` as `before-last-${number}-messages`;

  let next = pruneMessages({
    messages,
    toolCalls,
    emptyMessages: "remove",
  });

  if (next.length === 0) return next;
  if (next.length <= maxMessages) return next;

  // Preserve the full instruction head, not just a single leading message.
  // Instruction head is everything before the first assistant/tool message.
  let headCount = 0;
  while (headCount < next.length) {
    const role = next[headCount]?.role;
    if (role === "assistant" || role === "tool") break;
    headCount += 1;
  }

  if (headCount === 0) {
    headCount = 1;
  }
  if (headCount >= maxMessages) {
    return next.slice(0, maxMessages);
  }

  const budget = Math.max(0, maxMessages - headCount);

  let start = Math.max(headCount, next.length - budget);
  while (start < next.length && next[start]?.role === "tool") {
    start += 1;
  }

  next = [...next.slice(0, headCount), ...next.slice(start)];
  return next;
}
