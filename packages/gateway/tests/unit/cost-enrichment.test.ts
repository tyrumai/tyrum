import { describe, it, expect } from "vitest";
import { enrichAttemptCost, type CostLookup } from "../../src/modules/execution/cost-enrichment.js";
import type { AttemptCost as AttemptCostT } from "@tyrum/schemas";

function makeLookup(models: Record<string, { cost?: { input: number; output: number } }>): CostLookup {
  return {
    getModel(id: string) {
      return models[id];
    },
  };
}

describe("enrichAttemptCost", () => {
  it("enriches cost when model found in catalog", () => {
    const cost: AttemptCostT = { model: "gpt-4", input_tokens: 100, output_tokens: 50 };
    const lookup = makeLookup({
      "gpt-4": { cost: { input: 0.00003, output: 0.00006 } },
    });

    const result = enrichAttemptCost(cost, lookup);

    // (100 * 0.00003 + 50 * 0.00006) * 1_000_000 = (0.003 + 0.003) * 1_000_000 = 6000
    expect(result.usd_micros).toBe(6000);
    expect(result.model).toBe("gpt-4");
    expect(result.input_tokens).toBe(100);
    expect(result.output_tokens).toBe(50);
  });

  it("skips enrichment when usd_micros already set", () => {
    const cost: AttemptCostT = { model: "gpt-4", input_tokens: 100, output_tokens: 50, usd_micros: 42 };
    const lookup = makeLookup({
      "gpt-4": { cost: { input: 0.00003, output: 0.00006 } },
    });

    const result = enrichAttemptCost(cost, lookup);

    expect(result.usd_micros).toBe(42);
    expect(result).toBe(cost); // same reference, not modified
  });

  it("skips enrichment when model not in catalog", () => {
    const cost: AttemptCostT = { model: "unknown-model", input_tokens: 100, output_tokens: 50 };
    const lookup = makeLookup({});

    const result = enrichAttemptCost(cost, lookup);

    expect(result.usd_micros).toBeUndefined();
    expect(result).toBe(cost);
  });

  it("handles missing token counts (no enrichment for 0 tokens)", () => {
    const cost: AttemptCostT = { model: "gpt-4" };
    const lookup = makeLookup({
      "gpt-4": { cost: { input: 0.00003, output: 0.00006 } },
    });

    const result = enrichAttemptCost(cost, lookup);

    expect(result.usd_micros).toBeUndefined();
    expect(result).toBe(cost);
  });
});
