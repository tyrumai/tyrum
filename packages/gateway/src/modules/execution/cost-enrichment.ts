import type { AttemptCost as AttemptCostT } from "@tyrum/schemas";

export interface CostLookup {
  getModel(id: string): { cost?: { input: number; output: number } } | undefined;
}

export function enrichAttemptCost(cost: AttemptCostT, lookup: CostLookup): AttemptCostT {
  // If usd_micros already set, return as-is (executor knows best)
  if (typeof cost.usd_micros === "number") return cost;

  // Need model + token counts to compute
  if (!cost.model) return cost;
  const inputTokens = cost.input_tokens ?? 0;
  const outputTokens = cost.output_tokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return cost;

  const model = lookup.getModel(cost.model);
  if (!model?.cost) return cost;

  const usdMicros = Math.round(
    (inputTokens * model.cost.input + outputTokens * model.cost.output) * 1_000_000,
  );

  return { ...cost, usd_micros: usdMicros };
}
