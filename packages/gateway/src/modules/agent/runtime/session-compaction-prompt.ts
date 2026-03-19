import { z } from "zod";
import type { CheckpointSummary, TyrumUIMessage } from "@tyrum/contracts";
import { buildCheckpointPromptText, renderMessagesForCompaction } from "./session-context-state.js";

export const COMPACTION_JSON_SCHEMA = z.object({
  goal: z.string().default(""),
  user_constraints: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  discoveries: z.array(z.string()).default([]),
  completed_work: z.array(z.string()).default([]),
  pending_work: z.array(z.string()).default([]),
  unresolved_questions: z.array(z.string()).default([]),
  critical_identifiers: z.array(z.string()).default([]),
  relevant_files: z.array(z.string()).default([]),
  handoff_md: z.string().default(""),
});

export function buildCompactionInstruction(input: {
  previousCheckpoint: CheckpointSummary | null;
  droppedMessages: readonly TyrumUIMessage[];
  criticalIdentifiers: readonly string[];
  relevantFiles: readonly string[];
  auditFeedback?: readonly string[];
}): string {
  const previous = input.previousCheckpoint
    ? `Existing checkpoint:\n${buildCheckpointPromptText(input.previousCheckpoint)}`
    : "Existing checkpoint: none";
  const identifiers =
    input.criticalIdentifiers.length > 0
      ? `Identifiers that must be preserved exactly if still relevant: ${input.criticalIdentifiers.join(", ")}`
      : "Identifiers that must be preserved exactly if still relevant: none";
  const files =
    input.relevantFiles.length > 0
      ? `Likely relevant files/paths: ${input.relevantFiles.join(", ")}`
      : "Likely relevant files/paths: none";

  return [
    "You are generating an internal checkpoint summary for another run of the same agent.",
    "Compress the older session context into a high-signal checkpoint without answering the user directly.",
    "Prefer concrete facts, exact identifiers, decisions, constraints, pending work, and unresolved questions.",
    "Do not invent facts, outcomes, commands, file paths, identifiers, or open questions that are not supported by the checkpoint or compacted messages.",
    "Preserve commands, file paths, identifiers, and literal values verbatim when they are still relevant.",
    "If the existing checkpoint conflicts with the compacted messages, prefer the supported newer evidence instead of merging both blindly.",
    "Return JSON only with this exact shape:",
    JSON.stringify(COMPACTION_JSON_SCHEMA.parse({}), null, 2),
    "",
    previous,
    "",
    identifiers,
    files,
    input.auditFeedback && input.auditFeedback.length > 0
      ? `Correctness requirements for this retry:\n${input.auditFeedback.map((item) => `- ${item}`).join("\n")}`
      : "",
    "",
    "Conversation history being compacted:",
    renderMessagesForCompaction(input.droppedMessages),
  ].join("\n");
}

function checkpointTextIndex(checkpoint: CheckpointSummary): string {
  return [
    checkpoint.goal,
    ...checkpoint.user_constraints,
    ...checkpoint.decisions,
    ...checkpoint.discoveries,
    ...checkpoint.completed_work,
    ...checkpoint.pending_work,
    ...checkpoint.unresolved_questions,
    ...checkpoint.critical_identifiers,
    ...checkpoint.relevant_files,
    checkpoint.handoff_md,
  ]
    .join("\n")
    .toLowerCase();
}

export function findCheckpointDeficiencies(input: {
  checkpoint: CheckpointSummary;
  criticalIdentifiers: readonly string[];
  droppedMessages: readonly TyrumUIMessage[];
}): string[] {
  const deficiencies: string[] = [];
  const textIndex = checkpointTextIndex(input.checkpoint);
  const missingIdentifiers = input.criticalIdentifiers.filter(
    (identifier) => identifier.trim().length > 0 && !textIndex.includes(identifier.toLowerCase()),
  );
  if (missingIdentifiers.length > 0) {
    deficiencies.push(
      `Preserve these identifiers exactly if they are still relevant: ${missingIdentifiers.join(", ")}`,
    );
  }

  const droppedText = input.droppedMessages
    .map((message) => renderMessagesForCompaction([message]))
    .join("\n")
    .trim();
  const hasSignal = checkpointTextIndex(input.checkpoint).replace(/\s+/g, "").length > 0;
  if (droppedText.length > 0 && !hasSignal) {
    deficiencies.push(
      "The checkpoint is empty. Capture goals, decisions, discoveries, pending work, or unresolved questions.",
    );
  }

  return deficiencies;
}
