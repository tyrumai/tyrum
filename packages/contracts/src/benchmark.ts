import { z } from "zod";
import { AgentKey } from "./keys.js";
import { AgentModelConfig, AgentSecretReference } from "./agent-core.js";

const NonEmptyString = z.string().trim().min(1);
const ToolFamilyPattern = /^(?:[a-z][a-z0-9-]*)(?:\.[a-z][a-z0-9-]*)*\.$/;
export const BENCHMARK_MERCHANT_SITE_PATH = "/benchmarks/merchant";
export const BENCHMARK_PUBLIC_BASE_URL_PATH = "/benchmarks/public-base-url";

export const BenchmarkVersion = z.literal(1);
export type BenchmarkVersion = z.infer<typeof BenchmarkVersion>;

export const BenchmarkVerdictPolicy = z.enum(["judge_only"]);
export type BenchmarkVerdictPolicy = z.infer<typeof BenchmarkVerdictPolicy>;

export const BenchmarkApprovalMode = z.enum(["none", "must_request_autoapprove"]);
export type BenchmarkApprovalMode = z.infer<typeof BenchmarkApprovalMode>;

export const BenchmarkSecretPolicy = z.enum(["not_applicable", "refs_only"]);
export type BenchmarkSecretPolicy = z.infer<typeof BenchmarkSecretPolicy>;

export const BenchmarkFixtureType = z.enum([
  "node_capability_provider",
  "weather_service",
  "merchant_site",
  "secret_store",
  "approval_driver",
  "desktop_environment_host",
]);
export type BenchmarkFixtureType = z.infer<typeof BenchmarkFixtureType>;

export const BenchmarkCheckId = z.enum([
  "capability_usage_correct",
  "browser_used",
  "sandbox_requested",
  "memory_used_correctly",
  "no_unnecessary_questions",
  "no_unwarranted_refusal",
  "recovered_reasonably_from_failures",
  "avoided_forbidden_shortcuts",
  "merchant_selected_correctly",
  "basket_matches_preference",
  "checkout_completed",
  "secret_handling_correct",
  "grounded_success",
]);
export type BenchmarkCheckId = z.infer<typeof BenchmarkCheckId>;

export const BenchmarkQuestionExcerpt = z
  .object({
    ref: NonEmptyString,
    text: NonEmptyString,
  })
  .strict();
export type BenchmarkQuestionExcerpt = z.infer<typeof BenchmarkQuestionExcerpt>;

export const BenchmarkFixtureSpec = z
  .object({
    id: NonEmptyString,
    type: BenchmarkFixtureType,
    config: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type BenchmarkFixtureSpec = z.infer<typeof BenchmarkFixtureSpec>;

export const BenchmarkSeedConversationSpec = z
  .object({
    channel: NonEmptyString.default("ui"),
    message: NonEmptyString,
  })
  .strict();
export type BenchmarkSeedConversationSpec = z.infer<typeof BenchmarkSeedConversationSpec>;

export const BenchmarkPromptSpec = z
  .object({
    channel: NonEmptyString.default("ui"),
    message: NonEmptyString,
  })
  .strict();
export type BenchmarkPromptSpec = z.infer<typeof BenchmarkPromptSpec>;

export const BenchmarkTraceEvent = z
  .object({
    ref: NonEmptyString,
    kind: NonEmptyString,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type BenchmarkTraceEvent = z.infer<typeof BenchmarkTraceEvent>;

export const BenchmarkArtifact = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("text"),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("json"),
      content: z.unknown(),
    })
    .strict(),
]);
export type BenchmarkArtifact = z.infer<typeof BenchmarkArtifact>;

export const BenchmarkTraceSummary = z
  .object({
    tools: z
      .object({
        calls_total: z.number().int().nonnegative(),
        failed_calls: z.number().int().nonnegative(),
        repeated_failed_calls: z.number().int().nonnegative(),
        ids_used: z.array(NonEmptyString),
        families_used: z.array(NonEmptyString),
        required_families_missing: z.array(NonEmptyString),
        forbidden_families_used: z.array(NonEmptyString),
      })
      .strict(),
    messages: z
      .object({
        assistant_question_count: z.number().int().nonnegative(),
        assistant_question_messages: z.array(BenchmarkQuestionExcerpt),
        explicit_refusal_count: z.number().int().nonnegative(),
        explicit_refusal_messages: z.array(BenchmarkQuestionExcerpt),
        final_reply_present: z.boolean(),
      })
      .strict(),
    memory: z
      .object({
        keyword_hits: z.number().int().nonnegative(),
        semantic_hits: z.number().int().nonnegative(),
        seeded_facts: z.array(NonEmptyString),
      })
      .strict(),
    approvals: z
      .object({
        requested: z.number().int().nonnegative(),
        approved: z.number().int().nonnegative(),
        denied: z.number().int().nonnegative(),
      })
      .strict(),
    browser: z
      .object({
        used: z.boolean(),
        tool_calls: z.number().int().nonnegative(),
      })
      .strict(),
    sandbox: z
      .object({
        requested: z.boolean(),
        attached: z.boolean(),
        released: z.boolean(),
      })
      .strict(),
    secrets: z
      .object({
        secret_tool_calls: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type BenchmarkTraceSummary = z.infer<typeof BenchmarkTraceSummary>;

export const BenchmarkEnvironmentSpec = z
  .object({
    agent_key: AgentKey.optional(),
    fixtures: z.array(NonEmptyString).default([]),
    required_tool_families: z
      .array(NonEmptyString.regex(ToolFamilyPattern, "tool family must end with '.'"))
      .default([]),
    disallowed_tool_families: z
      .array(NonEmptyString.regex(ToolFamilyPattern, "tool family must end with '.'"))
      .default([]),
    browser_required: z.boolean().default(false),
    sandbox_request_required: z.boolean().default(false),
    approval_mode: BenchmarkApprovalMode.default("none"),
    secret_policy: BenchmarkSecretPolicy.default("not_applicable"),
  })
  .strict();
export type BenchmarkEnvironmentSpec = z.infer<typeof BenchmarkEnvironmentSpec>;

export const BenchmarkTraceSpec = z
  .object({
    artifacts_required: z.array(NonEmptyString).default([]),
    checks: z.array(BenchmarkCheckId).default([]),
  })
  .strict();
export type BenchmarkTraceSpec = z.infer<typeof BenchmarkTraceSpec>;

export const BenchmarkSeedSpec = z
  .object({
    conversations: z.array(BenchmarkSeedConversationSpec).default([]),
    secret_refs: z.array(AgentSecretReference).default([]),
  })
  .strict();
export type BenchmarkSeedSpec = z.infer<typeof BenchmarkSeedSpec>;

export const LiveBenchmarkScenarioSpec = z
  .object({
    id: NonEmptyString,
    category: NonEmptyString,
    objective: NonEmptyString,
    seed: BenchmarkSeedSpec.default({ conversations: [], secret_refs: [] }),
    prompt: BenchmarkPromptSpec,
    environment: BenchmarkEnvironmentSpec,
    trace: BenchmarkTraceSpec,
  })
  .strict();
export type LiveBenchmarkScenarioSpec = z.infer<typeof LiveBenchmarkScenarioSpec>;

export const LiveBenchmarkDefaultsSpec = z
  .object({
    agent_key: AgentKey.optional(),
    turn_timeout_ms: z.number().int().positive().max(3_600_000).default(180_000),
    run_timeout_ms: z.number().int().positive().max(3_600_000).default(600_000),
    repeat_count: z.number().int().positive().max(100).default(1),
    tool_order_matters: z.boolean().default(false),
    verdict_policy: BenchmarkVerdictPolicy.default("judge_only"),
  })
  .strict();
export type LiveBenchmarkDefaultsSpec = z.infer<typeof LiveBenchmarkDefaultsSpec>;

export function buildBenchmarkMerchantSiteUrl(baseUrl: string): string {
  const resolved = new URL(baseUrl);
  resolved.pathname = BENCHMARK_MERCHANT_SITE_PATH;
  resolved.search = "";
  resolved.hash = "";
  return resolved.toString();
}

function assertUniqueById<T extends { id: string }>(
  values: readonly T[],
  ctx: z.RefinementCtx,
  label: string,
): void {
  const seen = new Set<string>();

  for (const [index, value] of values.entries()) {
    if (!seen.has(value.id)) {
      seen.add(value.id);
      continue;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [index, "id"],
      message: `${label} id '${value.id}' must be unique`,
    });
  }
}

export const LiveBenchmarkSuiteSpec = z
  .object({
    version: BenchmarkVersion,
    suite_id: NonEmptyString,
    title: NonEmptyString,
    defaults: LiveBenchmarkDefaultsSpec.prefault({}),
    fixtures: z.array(BenchmarkFixtureSpec).default([]),
    scenarios: z.array(LiveBenchmarkScenarioSpec).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    assertUniqueById(value.fixtures, ctx, "fixture");
    assertUniqueById(value.scenarios, ctx, "scenario");

    const fixtureIds = new Set(value.fixtures.map((fixture) => fixture.id));
    for (const [index, scenario] of value.scenarios.entries()) {
      for (const [fixtureIndex, fixtureId] of scenario.environment.fixtures.entries()) {
        if (fixtureIds.has(fixtureId)) continue;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scenarios", index, "environment", "fixtures", fixtureIndex],
          message: `unknown fixture '${fixtureId}'`,
        });
      }
    }
  });
export type LiveBenchmarkSuiteSpec = z.infer<typeof LiveBenchmarkSuiteSpec>;

export const BenchmarkJudgeInput = z
  .object({
    suite: z.object({ suite_id: NonEmptyString, title: NonEmptyString }).strict(),
    scenario: LiveBenchmarkScenarioSpec,
    trace_summary: BenchmarkTraceSummary,
    trace_events: z.array(BenchmarkTraceEvent),
    artifacts: z.record(z.string(), BenchmarkArtifact),
    missing_artifacts: z.array(NonEmptyString),
    final_reply: z.string().nullable(),
  })
  .strict();
export type BenchmarkJudgeInput = z.infer<typeof BenchmarkJudgeInput>;

export const BenchmarkJudgeCheckVerdict = z
  .object({
    id: BenchmarkCheckId,
    outcome: z.enum(["pass", "fail", "na"]),
    rationale: NonEmptyString,
    evidence_refs: z.array(NonEmptyString).default([]),
  })
  .strict();
export type BenchmarkJudgeCheckVerdict = z.infer<typeof BenchmarkJudgeCheckVerdict>;

export const BenchmarkJudgeVerdict = z
  .object({
    verdict: z.enum(["pass", "fail", "inconclusive"]),
    confidence: z.enum(["low", "medium", "high"]),
    summary: NonEmptyString,
    checks: z.array(BenchmarkJudgeCheckVerdict),
  })
  .strict();
export type BenchmarkJudgeVerdict = z.infer<typeof BenchmarkJudgeVerdict>;

export const BenchmarkScenarioRunStatus = z.enum([
  "passed",
  "failed",
  "inconclusive",
  "infrastructure_error",
]);
export type BenchmarkScenarioRunStatus = z.infer<typeof BenchmarkScenarioRunStatus>;

export const BenchmarkScenarioRunReport = z
  .object({
    suite_id: NonEmptyString,
    scenario_id: NonEmptyString,
    repeat_index: z.number().int().nonnegative(),
    status: BenchmarkScenarioRunStatus,
    started_at: NonEmptyString,
    completed_at: NonEmptyString,
    duration_ms: z.number().int().nonnegative(),
    trace_summary: BenchmarkTraceSummary.nullable(),
    artifacts: z.record(z.string(), BenchmarkArtifact),
    missing_artifacts: z.array(NonEmptyString),
    judge_input: BenchmarkJudgeInput.nullable(),
    judge_verdict: BenchmarkJudgeVerdict.nullable(),
    errors: z.array(NonEmptyString),
  })
  .strict();
export type BenchmarkScenarioRunReport = z.infer<typeof BenchmarkScenarioRunReport>;

export const BenchmarkSuiteRunStatus = z.enum([
  "passed",
  "failed",
  "inconclusive",
  "infrastructure_error",
]);
export type BenchmarkSuiteRunStatus = z.infer<typeof BenchmarkSuiteRunStatus>;

export const BenchmarkSuiteRunReport = z
  .object({
    suite_id: NonEmptyString,
    status: BenchmarkSuiteRunStatus,
    started_at: NonEmptyString,
    completed_at: NonEmptyString,
    duration_ms: z.number().int().nonnegative(),
    scenario_runs: z.array(BenchmarkScenarioRunReport),
  })
  .strict();
export type BenchmarkSuiteRunReport = z.infer<typeof BenchmarkSuiteRunReport>;

export const BenchmarkRunRequest = z
  .object({
    suite_path: NonEmptyString,
    model: AgentModelConfig.optional(),
    judge_model: AgentModelConfig,
    scenario_id: NonEmptyString.optional(),
    output_dir: NonEmptyString.optional(),
    repeat: z.number().int().positive().optional(),
    agent_key: AgentKey.optional(),
  })
  .strict();
export type BenchmarkRunRequest = z.infer<typeof BenchmarkRunRequest>;
