import type { ToolDescriptor } from "./tools.js";
import {
  WORKBOARD_TOOL_INPUT_SCHEMAS,
  type WorkboardToolId,
} from "./tool-catalog-workboard-schemas.js";

const DEFAULT_WORKBOARD_KEYWORDS = [
  "workboard",
  "task",
  "subagent",
  "clarification",
  "state",
] as const;

const WORKBOARD_TOOL_METADATA = {
  "workboard.capture": {
    description:
      "Create a backlog WorkItem and queue planner refinement. Use when work is multi-step, ambiguous, or should continue beyond the current turn.",
    keywords: ["workboard", "capture", "backlog", "refine", "plan", "task"] as const,
  },
  "workboard.item.list": {
    description: "List WorkItems in the current work scope.",
  },
  "workboard.item.get": {
    description: "Fetch a single WorkItem by id.",
  },
  "workboard.item.create": {
    description: "Create a WorkItem directly in the current work scope.",
  },
  "workboard.item.delete": {
    description: "Delete a WorkItem from the current work scope.",
  },
  "workboard.item.update": {
    description: "Update mutable WorkItem fields such as title, priority, or acceptance.",
  },
  "workboard.item.transition": {
    description: "Transition a WorkItem to a new top-level state.",
  },
  "workboard.task.list": {
    description: "List tasks for a WorkItem.",
  },
  "workboard.task.get": {
    description: "Fetch a task for the current work scope by id.",
  },
  "workboard.task.create": {
    description: "Create a task for a WorkItem.",
  },
  "workboard.task.delete": {
    description: "Delete a task from the current work scope.",
  },
  "workboard.task.update": {
    description: "Update a WorkItem task.",
  },
  "workboard.artifact.list": {
    description: "List WorkBoard artifacts.",
  },
  "workboard.artifact.get": {
    description: "Fetch a WorkBoard artifact by id.",
  },
  "workboard.artifact.create": {
    description: "Create a WorkBoard artifact.",
  },
  "workboard.artifact.delete": {
    description: "Delete a WorkBoard artifact by id.",
  },
  "workboard.decision.list": {
    description: "List WorkBoard decisions.",
  },
  "workboard.decision.get": {
    description: "Fetch a WorkBoard decision by id.",
  },
  "workboard.decision.create": {
    description: "Create a WorkBoard decision.",
  },
  "workboard.decision.delete": {
    description: "Delete a WorkBoard decision by id.",
  },
  "workboard.signal.list": {
    description: "List WorkBoard signals.",
  },
  "workboard.signal.get": {
    description: "Fetch a WorkBoard signal by id.",
  },
  "workboard.signal.create": {
    description: "Create a WorkBoard signal.",
  },
  "workboard.signal.delete": {
    description: "Delete a WorkBoard signal by id.",
  },
  "workboard.signal.update": {
    description: "Update a WorkBoard signal.",
  },
  "workboard.state.list": {
    description: "List WorkBoard state entries for the agent or a WorkItem.",
  },
  "workboard.state.get": {
    description: "Fetch a WorkBoard state entry.",
  },
  "workboard.state.delete": {
    description: "Delete a WorkBoard state entry.",
  },
  "workboard.state.set": {
    description: "Set a WorkBoard state entry.",
  },
  "workboard.subagent.list": {
    description: "List subagents for the current work scope.",
  },
  "workboard.subagent.get": {
    description: "Fetch a subagent by id.",
  },
  "workboard.subagent.spawn": {
    description: "Spawn a helper subagent and run a bounded prompt through it.",
  },
  "workboard.subagent.send": {
    description: "Send another prompt to an existing subagent.",
  },
  "workboard.subagent.close": {
    description: "Request subagent closure.",
  },
  "workboard.clarification.list": {
    description: "List clarification requests for the current work scope.",
  },
  "workboard.clarification.request": {
    description:
      "Request clarification through the main user-facing agent and send a steer notification.",
  },
  "workboard.clarification.answer": {
    description: "Answer a clarification request on behalf of the main user-facing agent.",
  },
  "workboard.clarification.cancel": {
    description: "Cancel an open clarification request.",
  },
} as const satisfies Record<
  WorkboardToolId,
  {
    description: string;
    keywords?: readonly string[];
  }
>;

function classifyWorkboardToolRisk(id: WorkboardToolId): "low" | "medium" {
  if (id.endsWith(".list") || id.endsWith(".get")) {
    return "low";
  }
  return "medium";
}

export const WORKBOARD_TOOL_REGISTRY: readonly ToolDescriptor[] = (
  Object.keys(WORKBOARD_TOOL_METADATA) as WorkboardToolId[]
).map((id) => {
  const metadata = WORKBOARD_TOOL_METADATA[id];
  return {
    id,
    description: metadata.description,
    risk: classifyWorkboardToolRisk(id),
    requires_confirmation: false,
    keywords: "keywords" in metadata ? metadata.keywords : DEFAULT_WORKBOARD_KEYWORDS,
    source: "builtin",
    family: "workboard",
    inputSchema: WORKBOARD_TOOL_INPUT_SCHEMAS[id],
  };
});
