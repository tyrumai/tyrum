import { describe, expect, it } from "vitest";
import {
  BenchmarkJudgeVerdict,
  LiveBenchmarkSuiteSpec,
  type BenchmarkJudgeVerdict as BenchmarkJudgeVerdictT,
} from "../src/index.js";

describe("benchmark contracts", () => {
  it("parses a suite with sandbox-aware commerce expectations", () => {
    const parsed = LiveBenchmarkSuiteSpec.parse({
      version: 1,
      suite_id: "core-live-v1",
      title: "Core Live Benchmarks",
      defaults: {
        agent_key: "default",
        turn_timeout_ms: 180_000,
        run_timeout_ms: 600_000,
        repeat_count: 1,
        tool_order_matters: false,
        verdict_policy: "judge_only",
      },
      fixtures: [
        { id: "desktop-host", type: "desktop_environment_host", config: {} },
        { id: "merchant", type: "merchant_site", config: { base_url: "https://merchant.local" } },
      ],
      scenarios: [
        {
          id: "order_local_pizza_via_browser",
          category: "commerce",
          objective: "Order the stored favorite pizza to the stored home address.",
          seed: {
            conversations: [
              { message: "My home address is 123 Benchmark Lane, Testville, CA 94000." },
              {
                message:
                  "My favorite pizza is a large thin-crust pepperoni pizza with mushrooms and no olives.",
              },
            ],
            secret_refs: [
              {
                secret_ref_id: "card-number",
                secret_alias: "card_number",
                allowed_tool_ids: ["tool.secret.copy-to-node-clipboard"],
              },
            ],
          },
          prompt: {
            channel: "ui",
            message:
              "Order my favorite pizza to my home and tell me the merchant, order id, and ETA.",
          },
          environment: {
            fixtures: ["desktop-host", "merchant"],
            required_tool_families: ["sandbox.", "tool.browser.", "tool.secret."],
            disallowed_tool_families: [],
            browser_required: true,
            sandbox_request_required: true,
            approval_mode: "must_request_autoapprove",
            secret_policy: "refs_only",
          },
          trace: {
            artifacts_required: ["final_reply", "transcript", "tool_events"],
            checks: [
              "sandbox_requested",
              "browser_used",
              "merchant_selected_correctly",
              "checkout_completed",
              "secret_handling_correct",
              "grounded_success",
            ],
          },
        },
      ],
    });

    expect(parsed.scenarios[0]?.environment.sandbox_request_required).toBe(true);
    expect(parsed.scenarios[0]?.seed.secret_refs).toHaveLength(1);
  });

  it("rejects unknown fixture references", () => {
    expect(() =>
      LiveBenchmarkSuiteSpec.parse({
        version: 1,
        suite_id: "suite",
        title: "Suite",
        fixtures: [],
        scenarios: [
          {
            id: "scenario",
            category: "weather",
            objective: "Check weather",
            seed: { conversations: [], secret_refs: [] },
            prompt: { channel: "ui", message: "Weather?" },
            environment: {
              fixtures: ["missing"],
              required_tool_families: ["tool.location."],
              disallowed_tool_families: [],
              browser_required: false,
              sandbox_request_required: false,
              approval_mode: "none",
              secret_policy: "not_applicable",
            },
            trace: { artifacts_required: [], checks: ["capability_usage_correct"] },
          },
        ],
      }),
    ).toThrow(/unknown fixture 'missing'/);
  });

  it("validates judge verdict evidence references", () => {
    const verdict: BenchmarkJudgeVerdictT = BenchmarkJudgeVerdict.parse({
      verdict: "fail",
      confidence: "high",
      summary: "The agent asked for a known address and never reached a confirmed checkout state.",
      checks: [
        {
          id: "no_unnecessary_questions",
          outcome: "fail",
          rationale: "The agent asked for the home address despite it being seeded.",
          evidence_refs: ["artifact:transcript", "trace:event:question-1"],
        },
      ],
    });

    expect(verdict.checks[0]?.evidence_refs).toContain("artifact:transcript");
  });
});
