import { z } from "zod";
import { Sha256Hex } from "./artifact.js";
import { DateTimeSchema } from "./common.js";
import { ExecutionBudgets, ExecutionRunId } from "./execution.js";

export const ToolIntentCostBudget = ExecutionBudgets.refine(
  (budget) =>
    budget.max_usd_micros !== undefined ||
    budget.max_duration_ms !== undefined ||
    budget.max_total_tokens !== undefined,
  "cost_budget must set at least one of max_usd_micros, max_duration_ms, max_total_tokens",
);
export type ToolIntentCostBudget = z.infer<typeof ToolIntentCostBudget>;

export const ToolIntentV1 = z
  .object({
    v: z.literal(1),

    goal: z.string().trim().min(1),
    expected_value: z.string().trim().min(1),
    cost_budget: ToolIntentCostBudget,
    side_effect_class: z.string().trim().min(1),
    risk_class: z.string().trim().min(1),
    expected_evidence: z
      .unknown()
      .refine((value) => value !== undefined, "expected_evidence is required"),

    execution_profile: z.string().trim().min(1).optional(),
    tool_allowlist: z.array(z.string().trim().min(1)).optional(),

    intent_graph_sha256: Sha256Hex,

    run_id: ExecutionRunId,
    step_index: z.number().int().nonnegative(),

    created_at: DateTimeSchema.optional(),
    created_by: z.string().trim().min(1).optional(),
  })
  .strict();
export type ToolIntentV1 = z.infer<typeof ToolIntentV1>;

export const ToolIntent = z.discriminatedUnion("v", [ToolIntentV1]);
export type ToolIntent = z.infer<typeof ToolIntent>;
