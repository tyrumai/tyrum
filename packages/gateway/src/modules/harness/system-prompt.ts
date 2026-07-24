import type { CheckpointSummary, IdentityPack } from "@tyrum/contracts";
import { buildCheckpointPromptText } from "../agent/runtime/conversation-context-state.js";
import {
  DATA_TAG_SAFETY_PROMPT,
  PROMPT_CONTRACT_PROMPT,
  formatIdentityPrompt,
} from "../agent/runtime/prompts.js";
import type { HarnessTurnContext } from "./types.js";

/**
 * Tyrum's harness-independent continuity layer, rendered for a harness that
 * only accepts an *append* to its own system prompt.
 *
 * Pure by design: every input is already-loaded data, so the composition is
 * directly testable and all IO stays in the planner.
 *
 * Two native prompt sections are deliberately not reproduced here:
 *
 *  - `Tool contracts:` / `Skill guidance:` enumerate Tyrum's *native* tool
 *    descriptors. A harness runs its own tools, so advertising them would
 *    invite calls the harness session cannot serve.
 *  - `formatRuntimePrompt` reports the gateway process (`process.cwd()`,
 *    `process.platform`, the selected `LanguageModel`). For a harness turn none
 *    of those describe the agent's environment — the harness reports its own —
 *    and there is no Tyrum-selected model to name. The narrower block below
 *    carries only facts this path actually knows.
 */
export interface HarnessSystemPromptInput {
  readonly context: HarnessTurnContext;
  /**
   * Identity with the agent's persona already applied
   * (`resolveAgentPersona` -> `applyPersonaToIdentity`). Passing a raw store
   * identity silently drops the configured persona name and tone.
   */
  readonly identity: IdentityPack;
  /** Null until the conversation has compacted at least once. */
  readonly checkpoint: CheckpointSummary | null;
  /** Pre-turn durable-memory recall, omitted when recall did not run. */
  readonly recallDigest?: string;
  readonly nowIso: string;
  readonly stateMode: string;
}

function formatHarnessRuntimeFacts(input: HarnessSystemPromptInput): string {
  const { context } = input;
  return [
    "Tyrum runtime:",
    `Current time: ${input.nowIso}`,
    `Gateway mode: ${input.stateMode}`,
    `Execution backend: ${context.backendId}`,
    `Workspace path: ${context.workspaceRoot}`,
    `Agent id: ${context.agentId}`,
    `Workspace id: ${context.workspaceId}`,
    `Conversation id: ${context.conversationId}`,
    `Channel: ${context.channel}`,
    `Thread id: ${context.threadId}`,
  ].join("\n");
}

/**
 * Builds the `systemPrompt.append` for a harness turn.
 *
 * Section order mirrors the native effective instructions: the standing
 * contract first, then per-conversation state. Natively the checkpoint is not
 * part of the system prompt at all — it arrives as a synthetic `system` message
 * that `splitSystemMessagesForInstructions` concatenates *after* the base
 * prompt — so it belongs at the end here, with recall last.
 */
export function buildHarnessSystemPromptAppend(input: HarnessSystemPromptInput): string {
  const checkpointText = input.checkpoint ? buildCheckpointPromptText(input.checkpoint) : "";
  const recall = input.recallDigest?.trim() ?? "";

  return [
    formatIdentityPrompt(input.identity),
    PROMPT_CONTRACT_PROMPT,
    DATA_TAG_SAFETY_PROMPT,
    formatHarnessRuntimeFacts(input),
    checkpointText.length > 0 ? `Conversation state:\n${checkpointText}` : "",
    recall.length > 0 ? `Pre-turn recall (mcp.memory.seed):\n${recall}` : "",
  ]
    .filter((section) => section.trim().length > 0)
    .join("\n\n");
}
