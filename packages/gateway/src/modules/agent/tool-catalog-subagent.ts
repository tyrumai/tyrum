import type { ToolDescriptor } from "./tools.js";
import {
  SUBAGENT_TOOL_INPUT_SCHEMAS,
  type SubagentToolId,
} from "./tool-catalog-subagent-schemas.js";

const DEFAULT_SUBAGENT_KEYWORDS = ["subagent", "delegate", "helper", "review", "explore"] as const;

const SUBAGENT_TOOL_METADATA = {
  "subagent.spawn": {
    description:
      "Spawn a read-only helper subagent, run an initial prompt through it, and keep it available for follow-up.",
    keywords: ["subagent", "delegate", "helper", "spawn", "review", "explore"] as const,
    promptGuidance: [
      "Use spawn only for bounded helper work with a clear execution_profile.",
      "Make the initial message specific about the files, question, or output you want back.",
    ] as const,
    promptExamples: [
      '{"execution_profile":"explorer_ro","message":"Inspect the automation scheduler and summarize the functions that normalize cadence inputs."}',
    ] as const,
  },
  "subagent.list": {
    description: "List helper subagents created by the current session.",
  },
  "subagent.get": {
    description: "Fetch a helper subagent created by the current session.",
  },
  "subagent.send": {
    description: "Send a follow-up prompt to one of the current session's helper subagents.",
    promptGuidance: [
      "Use send for follow-up questions on an existing helper instead of spawning a new one.",
    ] as const,
    promptExamples: [
      '{"subagent_id":"subagent_123","message":"Focus on the retry path and cite the relevant functions."}',
    ] as const,
  },
  "subagent.close": {
    description: "Close one of the current session's helper subagents when it is no longer needed.",
    promptGuidance: [
      "Close helpers once their result is integrated so session state stays clean.",
    ] as const,
    promptExamples: [
      '{"subagent_id":"subagent_123","reason":"Analysis integrated into the main turn."}',
    ] as const,
  },
} as const satisfies Record<
  SubagentToolId,
  {
    description: string;
    keywords?: readonly string[];
    promptGuidance?: readonly string[];
    promptExamples?: readonly string[];
  }
>;

function classifySubagentToolEffect(id: SubagentToolId): ToolDescriptor["effect"] {
  if (id === "subagent.list" || id === "subagent.get") {
    return "read_only";
  }
  return "state_changing";
}

export const SUBAGENT_TOOL_REGISTRY: readonly ToolDescriptor[] = (
  Object.keys(SUBAGENT_TOOL_METADATA) as SubagentToolId[]
).map((id) => {
  const metadata = SUBAGENT_TOOL_METADATA[id];
  return {
    id,
    description: metadata.description,
    effect: classifySubagentToolEffect(id),
    keywords: "keywords" in metadata ? metadata.keywords : DEFAULT_SUBAGENT_KEYWORDS,
    source: "builtin",
    family: "subagent",
    inputSchema: SUBAGENT_TOOL_INPUT_SCHEMAS[id],
    promptGuidance: "promptGuidance" in metadata ? metadata.promptGuidance : undefined,
    promptExamples: "promptExamples" in metadata ? metadata.promptExamples : undefined,
  };
});
