import { pruneMessages } from "ai";
import type { ModelMessage } from "ai";

export type ContextPruningConfig = {
  max_messages: number;
  tool_prune_keep_last_messages: number;
};

const DEFAULT_CONTEXT_PRUNING: ContextPruningConfig = {
  max_messages: 0,
  tool_prune_keep_last_messages: 4,
};

function normalizeContextPruningConfig(
  cfg: ContextPruningConfig | undefined,
): ContextPruningConfig {
  const requestedMaxMessages = Math.floor(
    cfg?.max_messages ?? DEFAULT_CONTEXT_PRUNING.max_messages,
  );
  const maxMessages = requestedMaxMessages <= 0 ? 0 : Math.max(8, requestedMaxMessages);
  const keepLastToolMessages = Math.max(
    2,
    Math.floor(
      cfg?.tool_prune_keep_last_messages ?? DEFAULT_CONTEXT_PRUNING.tool_prune_keep_last_messages,
    ),
  );
  return {
    max_messages: maxMessages,
    tool_prune_keep_last_messages: keepLastToolMessages,
  };
}

export function applyDeterministicContextCompactionAndToolPruning(
  messages: ModelMessage[],
  contextPruning?: ContextPruningConfig,
): ModelMessage[] {
  const cfg = normalizeContextPruningConfig(contextPruning);
  const maxMessages = cfg.max_messages;
  const keepLastToolMessages = Math.min(
    cfg.tool_prune_keep_last_messages,
    maxMessages <= 0 ? cfg.tool_prune_keep_last_messages : Math.max(2, maxMessages - 1),
  );

  const toolCalls =
    `before-last-${keepLastToolMessages}-messages` as `before-last-${number}-messages`;

  let next = pruneMessages({
    messages,
    toolCalls,
    emptyMessages: "remove",
  });

  if (maxMessages <= 0) return next;
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
