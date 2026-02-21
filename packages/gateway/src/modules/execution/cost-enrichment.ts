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

  // models.dev expresses `model.cost.*` in USD per 1M tokens.
  // `usd_micros` is USD * 1e6, so the 1M-token denominator cancels out:
  // usd_micros = tokens * (USD / 1M tokens) * 1e6 = tokens * USD_per_1M
  const usdMicros = Math.round(inputTokens * model.cost.input + outputTokens * model.cost.output);

  return { ...cost, usd_micros: usdMicros };
}
