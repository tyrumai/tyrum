import {
  BenchmarkJudgeInput,
  BenchmarkScenarioRunReport,
  type BenchmarkArtifact,
  type BenchmarkCheckId,
  type BenchmarkJudgeInput as BenchmarkJudgeInputT,
  type BenchmarkJudgeVerdict,
  type BenchmarkScenarioRunReport as BenchmarkScenarioRunReportT,
  type BenchmarkSuiteRunReport as BenchmarkSuiteRunReportT,
  type LiveBenchmarkScenarioSpec,
  type LiveBenchmarkSuiteSpec,
} from "@tyrum/contracts";
import { summarizeBenchmarkTrace } from "./trace-normalizer.js";
import {
  collectArtifacts,
  collectTraceEvents,
  extractAssistantMessageExcerpts,
  type ConversationTrace,
} from "./trace-capture.js";

export class BenchmarkSuiteTimeoutError extends Error {
  readonly timeoutMs: number;
  scenarioRun: BenchmarkScenarioRunReportT | null;

  constructor(timeoutMs: number) {
    super(`benchmark suite timed out after ${String(timeoutMs)}ms`);
    this.name = "BenchmarkSuiteTimeoutError";
    this.timeoutMs = timeoutMs;
    this.scenarioRun = null;
  }
}

export type TurnTimeoutBudget = {
  timeoutMs: number;
  timeoutError?: Error;
};

export function buildInfrastructureScenarioRunReport(input: {
  suiteId: string;
  scenarioId: string;
  repeatIndex: number;
  startedAt: string;
  startedMs: number;
  errors: readonly string[];
  traceSummary?: BenchmarkJudgeInputT["trace_summary"] | null;
  artifacts?: Record<string, BenchmarkArtifact>;
  missingArtifacts?: string[];
}): BenchmarkScenarioRunReportT {
  return BenchmarkScenarioRunReport.parse({
    suite_id: input.suiteId,
    scenario_id: input.scenarioId,
    repeat_index: input.repeatIndex,
    status: "infrastructure_error",
    started_at: input.startedAt,
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - input.startedMs,
    trace_summary: input.traceSummary ?? null,
    artifacts: input.artifacts ?? {},
    missing_artifacts: input.missingArtifacts ?? [],
    judge_input: null,
    judge_verdict: null,
    errors: [...input.errors],
  });
}

export function getRemainingRunTimeMs(runDeadlineMs: number, runTimeoutMs: number): number {
  const remainingMs = runDeadlineMs - Date.now();
  if (remainingMs <= 0) {
    throw new BenchmarkSuiteTimeoutError(runTimeoutMs);
  }
  return remainingMs;
}

export function resolveTurnTimeoutBudget(
  turnTimeoutMs: number,
  runDeadlineMs: number,
  runTimeoutMs: number,
): TurnTimeoutBudget {
  const remainingMs = getRemainingRunTimeMs(runDeadlineMs, runTimeoutMs);
  if (remainingMs >= turnTimeoutMs) {
    return { timeoutMs: turnTimeoutMs };
  }
  return {
    timeoutMs: remainingMs,
    timeoutError: new BenchmarkSuiteTimeoutError(runTimeoutMs),
  };
}

function mapChecks(
  traceChecks: readonly BenchmarkCheckId[],
  extraChecks: readonly BenchmarkCheckId[],
): BenchmarkCheckId[] {
  return [...new Set([...traceChecks, ...extraChecks])];
}

function deriveExtraChecks(scenario: LiveBenchmarkScenarioSpec): BenchmarkCheckId[] {
  const checks: BenchmarkCheckId[] = [];
  if (scenario.environment.browser_required) checks.push("browser_used");
  if (scenario.environment.sandbox_request_required) checks.push("sandbox_requested");
  return checks;
}

export function mapJudgeVerdictToStatus(
  verdict: BenchmarkJudgeVerdict,
): BenchmarkScenarioRunReportT["status"] {
  if (verdict.verdict === "pass") return "passed";
  if (verdict.verdict === "fail") return "failed";
  return "inconclusive";
}

export function computeSuiteStatus(
  scenarioRuns: readonly BenchmarkScenarioRunReportT[],
): BenchmarkSuiteRunReportT["status"] {
  if (scenarioRuns.some((run) => run.status === "infrastructure_error")) {
    return "infrastructure_error";
  }
  if (scenarioRuns.some((run) => run.status === "failed")) {
    return "failed";
  }
  if (scenarioRuns.some((run) => run.status === "inconclusive")) {
    return "inconclusive";
  }
  return "passed";
}

export function createScenarioJudgeInput(
  suite: LiveBenchmarkSuiteSpec,
  scenario: LiveBenchmarkScenarioSpec,
  trace: ConversationTrace,
): BenchmarkJudgeInputT {
  const artifacts = collectArtifacts(trace);
  const missingArtifacts = scenario.trace.artifacts_required.filter(
    (artifactId: string) => !(artifactId in artifacts),
  );
  const assistantMessages = extractAssistantMessageExcerpts(trace.transcript);
  const traceSummary = summarizeBenchmarkTrace({
    toolEvents: trace.toolEvents,
    contextReports: trace.contextReports,
    approvals: trace.approvalEvents,
    assistantMessages,
    finalReply: trace.finalReply,
    requiredToolFamilies: scenario.environment.required_tool_families,
    disallowedToolFamilies: scenario.environment.disallowed_tool_families,
    seededFacts: scenario.seed.conversations.map(
      (conversation: LiveBenchmarkScenarioSpec["seed"]["conversations"][number]) =>
        conversation.message,
    ),
  });

  return BenchmarkJudgeInput.parse({
    suite: {
      suite_id: suite.suite_id,
      title: suite.title,
    },
    scenario: {
      ...scenario,
      trace: {
        ...scenario.trace,
        checks: mapChecks(scenario.trace.checks, deriveExtraChecks(scenario)),
      },
    },
    trace_summary: traceSummary,
    trace_events: collectTraceEvents(trace),
    artifacts,
    missing_artifacts: missingArtifacts,
    final_reply: trace.finalReply,
  });
}
