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
  },
  "subagent.list": {
    description: "List helper subagents created by the current session.",
  },
  "subagent.get": {
    description: "Fetch a helper subagent created by the current session.",
  },
  "subagent.send": {
    description: "Send a follow-up prompt to one of the current session's helper subagents.",
  },
  "subagent.close": {
    description: "Close one of the current session's helper subagents when it is no longer needed.",
  },
} as const satisfies Record<
  SubagentToolId,
  {
    description: string;
    keywords?: readonly string[];
  }
>;

function classifySubagentToolRisk(id: SubagentToolId): "low" | "medium" {
  if (id === "subagent.list" || id === "subagent.get") {
    return "low";
  }
  return "medium";
}

export const SUBAGENT_TOOL_REGISTRY: readonly ToolDescriptor[] = (
  Object.keys(SUBAGENT_TOOL_METADATA) as SubagentToolId[]
).map((id) => {
  const metadata = SUBAGENT_TOOL_METADATA[id];
  return {
    id,
    description: metadata.description,
    risk: classifySubagentToolRisk(id),
    requires_confirmation: false,
    keywords: "keywords" in metadata ? metadata.keywords : DEFAULT_SUBAGENT_KEYWORDS,
    source: "builtin",
    family: "subagent",
    inputSchema: SUBAGENT_TOOL_INPUT_SCHEMAS[id],
  };
});
