import type { ExecutionBudgets, Lane } from "@tyrum/schemas";

export type ExecutionProfileCapability = "subagent.spawn" | "work.write";

export type ExecutionProfileId =
  | "interaction"
  | "explorer_ro"
  | "reviewer_ro"
  | "planner"
  | "jury"
  | "executor_rw"
  | "integrator";

export type ExecutionProfile = {
  id: ExecutionProfileId;
  allowed_lanes: readonly Lane[];
  tool_allowlist: readonly string[];
  capabilities: readonly ExecutionProfileCapability[];
  model_id?: string;
  reasoning_effort?: "low" | "medium" | "high";
  budgets?: ExecutionBudgets;
  quotas?: {
    max_running_subagents?: number;
  };
};

const PROFILES: Record<ExecutionProfileId, ExecutionProfile> = {
  interaction: {
    id: "interaction",
    allowed_lanes: ["main"],
    tool_allowlist: ["*"],
    capabilities: ["subagent.spawn", "work.write"],
    model_id: "openai/gpt-5.4",
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
    tool_allowlist: ["tool.fs.read", "tool.http.fetch"],
    capabilities: [],
    model_id: "openai/gpt-5.4",
    reasoning_effort: "low",
    budgets: {
      max_duration_ms: 60_000,
      max_total_tokens: 25_000,
    },
  },
  reviewer_ro: {
    id: "reviewer_ro",
    allowed_lanes: ["subagent"],
    tool_allowlist: ["tool.fs.read", "tool.http.fetch"],
    capabilities: [],
    model_id: "openai/gpt-5.4",
    reasoning_effort: "low",
    budgets: {
      max_duration_ms: 60_000,
      max_total_tokens: 25_000,
    },
  },
  planner: {
    id: "planner",
    allowed_lanes: ["subagent"],
    tool_allowlist: ["tool.fs.read", "tool.http.fetch"],
    capabilities: ["subagent.spawn", "work.write"],
    model_id: "openai/gpt-5.4",
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
    tool_allowlist: ["tool.fs.read", "tool.http.fetch"],
    capabilities: [],
    model_id: "openai/gpt-5.4",
    reasoning_effort: "medium",
    budgets: {
      max_duration_ms: 60_000,
      max_total_tokens: 25_000,
    },
  },
  executor_rw: {
    id: "executor_rw",
    allowed_lanes: ["subagent"],
    tool_allowlist: ["tool.fs.read", "tool.fs.write", "tool.exec", "tool.http.fetch", "plugin.*"],
    capabilities: ["work.write"],
    model_id: "openai/gpt-5.4",
    reasoning_effort: "high",
    budgets: {
      max_duration_ms: 10 * 60_000,
      max_total_tokens: 200_000,
    },
  },
  integrator: {
    id: "integrator",
    allowed_lanes: ["subagent"],
    tool_allowlist: ["tool.fs.read", "tool.fs.write", "tool.exec", "tool.http.fetch", "plugin.*"],
    capabilities: ["work.write"],
    model_id: "openai/gpt-5.4",
    reasoning_effort: "high",
    budgets: {
      max_duration_ms: 10 * 60_000,
      max_total_tokens: 200_000,
    },
  },
};

const PROFILE_ALIASES: Record<string, ExecutionProfileId> = {
  executor: "executor_rw",
  explorer: "explorer_ro",
  reviewer: "reviewer_ro",
};

export function normalizeExecutionProfileId(raw: string): ExecutionProfileId | undefined {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  if (Object.prototype.hasOwnProperty.call(PROFILES, normalized)) {
    return normalized as ExecutionProfileId;
  }
  return PROFILE_ALIASES[normalized];
}

export function getExecutionProfile(id: ExecutionProfileId): ExecutionProfile {
  return PROFILES[id];
}
