import { describe, expect, it } from "vitest";

describe("ToolIntent", () => {
  it("parses a v1 ToolIntent record", async () => {
    const { ToolIntent } = (await import("../src/index.js")) as {
      ToolIntent?: { parse: (value: unknown) => unknown };
    };

    expect(ToolIntent).toBeDefined();

    const parsed = ToolIntent!.parse({
      v: 1,
      run_id: "550e8400-e29b-41d4-a716-446655440000",
      step_index: 0,
      goal: " Fetch example.com ",
      expected_value: " Confirm connectivity ",
      cost_budget: { max_duration_ms: 5_000 },
      side_effect_class: "network",
      risk_class: "low",
      expected_evidence: { http: { status: 200 } },
      intent_graph_sha256: "a".repeat(64),
    });

    expect(parsed).toMatchObject({
      v: 1,
      run_id: "550e8400-e29b-41d4-a716-446655440000",
      step_index: 0,
      goal: "Fetch example.com",
      expected_value: "Confirm connectivity",
      side_effect_class: "network",
      risk_class: "low",
      intent_graph_sha256: "a".repeat(64),
    });
  });

  it("rejects missing required fields", async () => {
    const { ToolIntent } = (await import("../src/index.js")) as {
      ToolIntent?: { parse: (value: unknown) => unknown };
    };

    expect(ToolIntent).toBeDefined();
    expect(() => ToolIntent!.parse({ v: 1 })).toThrow();
  });
});

