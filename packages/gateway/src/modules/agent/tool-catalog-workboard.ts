import type { ToolDescriptor } from "./tools.js";

const WORKBOARD_GENERIC_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
} as const;

function classifyWorkboardToolRisk(id: string): "low" | "medium" {
  if (id.endsWith(".list") || id.endsWith(".get")) {
    return "low";
  }
  return "medium";
}

export const WORKBOARD_TOOL_REGISTRY: readonly ToolDescriptor[] = [
  {
    id: "workboard.capture",
    description:
      "Create a backlog WorkItem and queue planner refinement. Use when work is multi-step, ambiguous, or should continue beyond the current turn.",
    risk: "medium",
    requires_confirmation: false,
    keywords: ["workboard", "capture", "backlog", "refine", "plan", "task"],
    source: "builtin",
    family: "workboard",
    inputSchema: WORKBOARD_GENERIC_INPUT_SCHEMA,
  },
  ...(
    [
      ["workboard.item.list", "List WorkItems in the current work scope."],
      ["workboard.item.get", "Fetch a single WorkItem by id."],
      ["workboard.item.create", "Create a WorkItem directly in the current work scope."],
      ["workboard.item.delete", "Delete a WorkItem from the current work scope."],
      [
        "workboard.item.update",
        "Update mutable WorkItem fields such as title, priority, or acceptance.",
      ],
      ["workboard.item.transition", "Transition a WorkItem to a new top-level state."],
      ["workboard.task.list", "List tasks for a WorkItem."],
      ["workboard.task.get", "Fetch a task for the current work scope by id."],
      ["workboard.task.create", "Create a task for a WorkItem."],
      ["workboard.task.delete", "Delete a task from the current work scope."],
      ["workboard.task.update", "Update a WorkItem task."],
      ["workboard.artifact.list", "List WorkBoard artifacts."],
      ["workboard.artifact.get", "Fetch a WorkBoard artifact by id."],
      ["workboard.artifact.create", "Create a WorkBoard artifact."],
      ["workboard.artifact.delete", "Delete a WorkBoard artifact by id."],
      ["workboard.decision.list", "List WorkBoard decisions."],
      ["workboard.decision.get", "Fetch a WorkBoard decision by id."],
      ["workboard.decision.create", "Create a WorkBoard decision."],
      ["workboard.decision.delete", "Delete a WorkBoard decision by id."],
      ["workboard.signal.list", "List WorkBoard signals."],
      ["workboard.signal.get", "Fetch a WorkBoard signal by id."],
      ["workboard.signal.create", "Create a WorkBoard signal."],
      ["workboard.signal.delete", "Delete a WorkBoard signal by id."],
      ["workboard.signal.update", "Update a WorkBoard signal."],
      ["workboard.state.list", "List WorkBoard state entries for the agent or a WorkItem."],
      ["workboard.state.get", "Fetch a WorkBoard state entry."],
      ["workboard.state.delete", "Delete a WorkBoard state entry."],
      ["workboard.state.set", "Set a WorkBoard state entry."],
      ["workboard.subagent.list", "List subagents for the current work scope."],
      ["workboard.subagent.get", "Fetch a subagent by id."],
      ["workboard.subagent.spawn", "Spawn a helper subagent and run a bounded prompt through it."],
      ["workboard.subagent.send", "Send another prompt to an existing subagent."],
      ["workboard.subagent.close", "Request subagent closure."],
      ["workboard.clarification.list", "List clarification requests for the current work scope."],
      [
        "workboard.clarification.request",
        "Request clarification through the main user-facing agent and send a steer notification.",
      ],
      [
        "workboard.clarification.answer",
        "Answer a clarification request on behalf of the main user-facing agent.",
      ],
      ["workboard.clarification.cancel", "Cancel an open clarification request."],
    ] as const
  ).map(([id, description]) => ({
    id,
    description,
    risk: classifyWorkboardToolRisk(id),
    requires_confirmation: false,
    keywords: ["workboard", "task", "subagent", "clarification", "state"],
    source: "builtin" as const,
    family: "workboard",
    inputSchema: WORKBOARD_GENERIC_INPUT_SCHEMA,
  })),
] as const;
