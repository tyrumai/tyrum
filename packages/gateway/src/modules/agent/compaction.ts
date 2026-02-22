import type { CompactionConfig as CompactionConfigT } from "@tyrum/schemas";
import type { SessionMessage } from "./session-dal.js";

const COMPACTION_SYSTEM_PROMPT = [
  "You are a session compaction assistant.",
  "Summarize the conversation history below into a concise summary.",
  "PRESERVE: approval decisions, user constraints and preferences, key facts learned, action outcomes, tool results that affected decisions.",
  "REMOVE: routine acknowledgments, repeated greetings, verbose tool output dumps, intermediate reasoning that led to the same conclusion.",
  "Output ONLY the summary, no preamble or explanation.",
].join(" ");

export interface CompactSessionOpts {
  turns: SessionMessage[];
  previousSummary: string;
  config: CompactionConfigT;
  generateFn: (opts: {
    system: string;
    prompt: string;
  }) => Promise<{ text: string }>;
  /** Optional pre-compaction hook to flush pending memory writes. */
  flushMemory?: () => Promise<void>;
}

export interface CompactSessionResult {
  summary: string;
  remainingTurns: SessionMessage[];
}

/** Check whether the session history should be compacted. */
export function shouldCompact(
  turns: SessionMessage[],
  config: CompactionConfigT,
): boolean {
  if (!config.enabled) return false;
  if (turns.length < config.trigger_message_count) return false;
  // Avoid wasteful compaction when we'd preserve all turns anyway.
  return turns.length > config.preserve_recent;
}

const TOOL_RESULT_MARKER = /\[tool[_-]result\b/i;

/** Truncate large tool-result content in a turn. */
function pruneToolResults(content: string, maxChars: number): string {
  if (content.length <= maxChars || !TOOL_RESULT_MARKER.test(content)) {
    return content;
  }
  return content.slice(0, maxChars) + "\n[...tool result truncated]";
}

/** Build the user prompt for the compaction LLM call. */
export function buildCompactionPrompt(
  turns: SessionMessage[],
  preserveRecent: number,
  previousSummary: string,
  toolResultMaxChars?: number,
): { olderTurns: SessionMessage[]; recentTurns: SessionMessage[]; prompt: string } {
  const splitAt = Math.max(0, turns.length - preserveRecent);
  const olderTurns = turns.slice(0, splitAt);
  const recentTurns = turns.slice(splitAt);

  // Prune large tool results in older turns before building the prompt
  const maxChars = toolResultMaxChars ?? 2048;
  const prunedOlderTurns = olderTurns.map((turn) => ({
    ...turn,
    content: pruneToolResults(turn.content, maxChars),
  }));

  const parts: string[] = [];

  if (previousSummary.trim().length > 0) {
    parts.push(`Previous session summary:\n${previousSummary}\n`);
  }

  parts.push("Conversation to summarize:");
  for (const turn of prunedOlderTurns) {
    parts.push(`[${turn.role}] ${turn.content}`);
  }

  return {
    olderTurns,
    recentTurns,
    prompt: parts.join("\n"),
  };
}

/** Compact a session's turn history using an LLM. */
export async function compactSession(
  opts: CompactSessionOpts,
): Promise<CompactSessionResult> {
  const { turns, previousSummary, config, generateFn } = opts;

  const { olderTurns, recentTurns, prompt } = buildCompactionPrompt(
    turns,
    config.preserve_recent,
    previousSummary,
    config.tool_result_max_chars,
  );

  if (olderTurns.length === 0) {
    return {
      summary: previousSummary.trim(),
      remainingTurns: turns,
    };
  }

  // Flush pending memory writes before compacting so no data is lost.
  if (opts.flushMemory) {
    await opts.flushMemory();
  }

  const result = await generateFn({
    system: COMPACTION_SYSTEM_PROMPT,
    prompt,
  });

  return {
    summary: result.text.trim(),
    remainingTurns: recentTurns,
  };
}
