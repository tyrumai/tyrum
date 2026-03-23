import type { ExecutionBudgets, Lane } from "@tyrum/contracts";

export type ExecutionProfileCapability = "subagent.spawn" | "work.write";

export type ExecutionProfileId =
  | "interaction"
  | "explorer_ro"
  | "reviewer_ro"
  | "planner"
  | "jury"
  | "executor_rw"
  | "integrator";

type ResolvedExecutionProfileId = Exclude<ExecutionProfileId, "integrator">;

export type ExecutionProfile = {
  id: ResolvedExecutionProfileId;
  allowed_lanes: readonly Lane[];
  tool_allowlist: readonly string[];
  tool_denylist?: readonly string[];
  capabilities: readonly ExecutionProfileCapability[];
  model_id?: string;
  reasoning_effort?: "low" | "medium" | "high";
  budgets?: ExecutionBudgets;
  quotas?: {
    max_running_subagents?: number;
  };
};

const PROFILES: Record<ResolvedExecutionProfileId, ExecutionProfile> = {
  interaction: {
    id: "interaction",
    allowed_lanes: ["main"],
    tool_allowlist: ["*"],
    tool_denylist: [
      "workboard.item.create",
      "workboard.item.delete",
      "workboard.item.update",
      "workboard.item.transition",
      "workboard.task.create",
      "workboard.task.delete",
      "workboard.task.update",
      "workboard.artifact.create",
      "workboard.artifact.delete",
      "workboard.decision.create",
      "workboard.decision.delete",
      "workboard.signal.create",
      "workboard.signal.delete",
      "workboard.signal.update",
      "workboard.state.delete",
      "workboard.state.set",
      "workboard.subagent.*",
      "workboard.clarification.request",
      "workboard.clarification.cancel",
    ],
    capabilities: ["subagent.spawn", "work.write"],
    reasoning_effort: "medium",
    budgets: {
      max_duration_ms: 30_000,
      max_total_tokens: 25_000,
    },
    quotas: {
      max_running_subagents: 8,
    },
  },
  explorer_ro: {
    id: "explorer_ro",
    allowed_lanes: ["subagent"],
    tool_allowlist: [
      "read",
      "artifact.describe",
      "webfetch",
      "websearch",
      "codesearch",
      "glob",
      "grep",
      "mcp.memory.seed",
      "mcp.memory.search",
      "sandbox.current",
      "workboard.item.list",
      "workboard.item.get",
      "workboard.task.list",
      "workboard.task.get",
      "workboard.artifact.list",
      "workboard.artifact.get",
      "workboard.decision.list",
      "workboard.decision.get",
      "workboard.signal.list",
      "workboard.signal.get",
      "workboard.state.list",
      "workboard.state.get",
      "workboard.clarification.list",
    ],
    capabilities: [],
    reasoning_effort: "low",
    budgets: {
      max_duration_ms: 60_000,
      max_total_tokens: 25_000,
    },
  },
  reviewer_ro: {
    id: "reviewer_ro",
    allowed_lanes: ["subagent"],
    tool_allowlist: [
      "read",
      "artifact.describe",
      "webfetch",
      "websearch",
      "codesearch",
      "glob",
      "grep",
      "mcp.memory.seed",
      "mcp.memory.search",
      "sandbox.current",
      "workboard.item.list",
      "workboard.item.get",
      "workboard.task.list",
      "workboard.task.get",
      "workboard.artifact.list",
      "workboard.artifact.get",
      "workboard.decision.list",
      "workboard.decision.get",
      "workboard.signal.list",
      "workboard.signal.get",
      "workboard.state.list",
      "workboard.state.get",
      "workboard.clarification.list",
    ],
    capabilities: [],
    reasoning_effort: "low",
    budgets: {
      max_duration_ms: 60_000,
      max_total_tokens: 25_000,
    },
  },
  planner: {
    id: "planner",
    allowed_lanes: ["subagent"],
    tool_allowlist: [
      "read",
      "artifact.describe",
      "webfetch",
      "websearch",
      "codesearch",
      "glob",
      "grep",
      "mcp.memory.seed",
      "mcp.memory.search",
      "sandbox.*",
      "workboard.item.*",
      "workboard.task.*",
      "workboard.artifact.*",
      "workboard.decision.*",
      "workboard.signal.*",
      "workboard.state.*",
      "workboard.clarification.list",
      "workboard.clarification.request",
      "subagent.*",
    ],
    capabilities: ["subagent.spawn", "work.write"],
    reasoning_effort: "high",
    budgets: {
      max_duration_ms: 5 * 60_000,
      max_total_tokens: 50_000,
    },
    quotas: {
      max_running_subagents: 16,
    },
  },
  jury: {
    id: "jury",
    allowed_lanes: ["subagent"],
    tool_allowlist: [
      "read",
      "webfetch",
      "websearch",
      "codesearch",
      "glob",
      "grep",
      "mcp.memory.seed",
      "mcp.memory.search",
      "sandbox.current",
      "workboard.item.list",
      "workboard.item.get",
      "workboard.task.list",
      "workboard.task.get",
      "workboard.artifact.list",
      "workboard.artifact.get",
      "workboard.decision.list",
      "workboard.decision.get",
      "workboard.signal.list",
      "workboard.signal.get",
      "workboard.state.list",
      "workboard.state.get",
      "workboard.clarification.list",
    ],
    capabilities: [],
    reasoning_effort: "medium",
    budgets: {
      max_duration_ms: 60_000,
      max_total_tokens: 25_000,
    },
  },
  executor_rw: {
    id: "executor_rw",
    allowed_lanes: ["subagent"],
    tool_allowlist: [
      "read",
      "artifact.describe",
      "write",
      "edit",
      "apply_patch",
      "bash",
      "glob",
      "grep",
      "websearch",
      "webfetch",
      "codesearch",
      "mcp.memory.seed",
      "mcp.memory.search",
      "mcp.memory.write",
      "sandbox.*",
      "plugin.*",
      "workboard.item.list",
      "workboard.item.get",
      "workboard.item.update",
      "workboard.item.delete",
      "workboard.item.transition",
      "workboard.task.list",
      "workboard.task.get",
      "workboard.task.create",
      "workboard.task.delete",
      "workboard.task.update",
      "workboard.artifact.*",
      "workboard.decision.*",
      "workboard.signal.*",
      "workboard.state.*",
      "workboard.clarification.list",
      "workboard.clarification.request",
    ],
    capabilities: ["work.write"],
    reasoning_effort: "high",
    budgets: {
      max_duration_ms: 10 * 60_000,
      max_total_tokens: 200_000,
    },
  },
};

const PROFILE_ALIASES: Record<string, ResolvedExecutionProfileId> = {
  executor: "executor_rw",
  explorer: "explorer_ro",
  reviewer: "reviewer_ro",
  integrator: "executor_rw",
};

export function normalizeExecutionProfileId(raw: string): ExecutionProfileId | undefined {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  const alias = PROFILE_ALIASES[normalized];
  if (alias) {
    return alias;
  }
  if (Object.prototype.hasOwnProperty.call(PROFILES, normalized)) {
    return normalized as ExecutionProfileId;
  }
  return undefined;
}

export function getExecutionProfile(id: ExecutionProfileId): ExecutionProfile {
  return id === "integrator" ? PROFILES.executor_rw : PROFILES[id];
}
