import { describe, expect, it } from "vitest";
import { ToolIntent } from "../src/index.js";

describe("ToolIntent", () => {
  const baseIntent = {
    v: 1,
    turn_id: "550e8400-e29b-41d4-a716-446655440000",
    step_index: 0,
    goal: " Fetch example.com ",
    expected_value: " Confirm connectivity ",
    side_effect_class: "network",
    risk_class: "low",
    expected_evidence: { http: { status: 200 } },
    intent_graph_sha256: "a".repeat(64),
  } as const;

  it("parses a v1 ToolIntent record", () => {
    const parsed = ToolIntent.parse({
      ...baseIntent,
      v: 1,
      cost_budget: { max_duration_ms: 5_000 },
    });

    expect(parsed).toMatchObject({
      v: 1,
      goal: "Fetch example.com",
      expected_value: "Confirm connectivity",
    });
  });

  it("parses token-budget-only cost budgets", () => {
    const parsed = ToolIntent.parse({
      ...baseIntent,
      step_index: 1,
      cost_budget: { max_total_tokens: 123 },
      execution_profile: "default",
      tool_allowlist: ["webfetch"],
      created_at: "2026-02-19T12:00:00Z",
      created_by: "agent:default:main",
    });

    expect(parsed.cost_budget.max_total_tokens).toBe(123);
    expect(parsed.tool_allowlist).toEqual(["webfetch"]);
  });

  it("rejects missing expected_evidence", () => {
    const intent = {
      ...baseIntent,
      cost_budget: { max_duration_ms: 5_000 },
    } as Record<string, unknown>;
    delete intent.expected_evidence;

    expect(() => ToolIntent.parse(intent)).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => ToolIntent.parse({ v: 1 })).toThrow();
  });
});
