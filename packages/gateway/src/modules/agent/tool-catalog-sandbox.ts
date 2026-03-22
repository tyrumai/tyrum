import type { ToolDescriptor } from "./tools.js";
import { SANDBOX_TOOL_INPUT_SCHEMAS, type SandboxToolId } from "./tool-catalog-sandbox-schemas.js";

const DEFAULT_SANDBOX_KEYWORDS = ["sandbox", "desktop", "browser", "managed", "handoff"] as const;

const SANDBOX_TOOL_METADATA = {
  "sandbox.current": {
    description: "Inspect the current lane's managed desktop attachment state.",
  },
  "sandbox.request": {
    description:
      "Request an exclusive managed desktop attachment for the current lane and wait briefly for the node to attach.",
    promptGuidance: [
      "Use request when the current lane needs live browser or desktop automation, not for ordinary file or shell work.",
      "Request once per lane and reuse the attachment until you are done, then release it.",
    ] as const,
    promptExamples: ['{"label":"executor:work_123"}'] as const,
  },
  "sandbox.release": {
    description: "Release the current lane's managed desktop attachment and delete the desktop.",
    promptGuidance: [
      "Release managed desktops when the lane no longer needs exclusive desktop control.",
    ] as const,
  },
  "sandbox.handoff": {
    description:
      "Transfer the current lane's managed desktop attachment to another same-tenant lane.",
    promptGuidance: [
      "Use handoff instead of sharing a live desktop concurrently when another lane should take over.",
      "Target lanes must be identified explicitly with target_key and target_lane.",
    ] as const,
    promptExamples: [
      '{"target_key":"agent:default:subagent:123e4567-e89b-12d3-a456-426614174111","target_lane":"subagent"}',
    ] as const,
  },
} as const satisfies Record<
  SandboxToolId,
  {
    description: string;
    promptGuidance?: readonly string[];
    promptExamples?: readonly string[];
  }
>;

function classifySandboxToolEffect(id: SandboxToolId): ToolDescriptor["effect"] {
  return id === "sandbox.current" ? "read_only" : "state_changing";
}

export const SANDBOX_TOOL_REGISTRY: readonly ToolDescriptor[] = (
  Object.keys(SANDBOX_TOOL_METADATA) as SandboxToolId[]
).map((id) => {
  const metadata = SANDBOX_TOOL_METADATA[id];
  return {
    id,
    description: metadata.description,
    effect: classifySandboxToolEffect(id),
    keywords: DEFAULT_SANDBOX_KEYWORDS,
    source: "builtin",
    family: "sandbox",
    inputSchema: SANDBOX_TOOL_INPUT_SCHEMAS[id],
    promptGuidance: "promptGuidance" in metadata ? metadata.promptGuidance : undefined,
    promptExamples: "promptExamples" in metadata ? metadata.promptExamples : undefined,
  };
});
