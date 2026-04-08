import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  AgentConfig,
  BenchmarkJudgeInput,
  BenchmarkRunRequest,
  BenchmarkScenarioRunReport,
  BenchmarkSuiteRunReport,
  WsConversationCreateResult,
  type AgentSecretReference,
  type BenchmarkArtifact,
  type BenchmarkCheckId,
  type BenchmarkJudgeInput as BenchmarkJudgeInputT,
  type BenchmarkJudgeVerdict,
  type BenchmarkScenarioRunReport as BenchmarkScenarioRunReportT,
  type BenchmarkSuiteRunReport as BenchmarkSuiteRunReportT,
  type LiveBenchmarkScenarioSpec,
  type LiveBenchmarkSuiteSpec,
  type WsConversationCreateResult as WsConversationCreateResultT,
  isDesktopEnvironmentHostAvailable,
} from "@tyrum/contracts";
import type { TyrumClient } from "@tyrum/operator-app/node";
import { loadBenchmarkSuiteFromFile } from "./load-suite.js";
import {
  createBenchmarkJudgeConfig,
  buildBenchmarkJudgePrompt,
  parseBenchmarkJudgeVerdict,
} from "./judge.js";
import { createBenchmarkOperatorSession, type BenchmarkHttpClient } from "./operator-session.js";
import { summarizeBenchmarkTrace } from "./trace-normalizer.js";
import {
  collectArtifacts,
  collectTraceEvents,
  extractAssistantMessageExcerpts,
  getTraceCaptureIntegrityErrors,
  sendPromptAndCollectTrace,
  type ConversationTrace,
} from "./trace-capture.js";

export { getTraceCaptureIntegrityErrors, sendPromptAndCollectTrace } from "./trace-capture.js";

class BenchmarkInfrastructureError extends Error {
  readonly artifacts: Record<string, BenchmarkArtifact>;
  readonly missingArtifacts: string[];
  readonly traceSummary: BenchmarkJudgeInputT["trace_summary"];

  constructor(
    message: string,
    details: {
      artifacts: Record<string, BenchmarkArtifact>;
      missingArtifacts: string[];
      traceSummary: BenchmarkJudgeInputT["trace_summary"];
    },
  ) {
    super(message);
    this.name = "BenchmarkInfrastructureError";
    this.artifacts = details.artifacts;
    this.missingArtifacts = details.missingArtifacts;
    this.traceSummary = details.traceSummary;
  }
}

type RunScenarioOptions = {
  http: BenchmarkHttpClient;
  ws: TyrumClient;
  suite: LiveBenchmarkSuiteSpec;
  scenario: LiveBenchmarkScenarioSpec;
  repeatIndex: number;
  modelOverride?: string;
  targetAgentKey: string;
  judgeAgentKey: string;
  turnTimeoutMs: number;
};

function sanitizeKeyPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "run"
  );
}

function createTempAgentKey(prefix: string, suiteId: string, scenarioId?: string): string {
  const suffix = randomUUID().slice(0, 8);
  const parts = [prefix, suiteId, scenarioId, suffix]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => sanitizeKeyPart(value));
  return parts.join("-");
}

function uniqueSecretRefs(secretRefs: readonly AgentSecretReference[]): AgentSecretReference[] {
  const byId = new Map<string, AgentSecretReference>();
  for (const secretRef of secretRefs) {
    byId.set(secretRef.secret_ref_id, secretRef);
  }
  return [...byId.values()];
}

function mergeAgentConfig(
  config: AgentConfig,
  secretRefs: readonly AgentSecretReference[],
  modelOverride?: string,
): AgentConfig {
  return AgentConfig.parse({
    ...config,
    model: modelOverride ? { ...config.model, model: modelOverride } : config.model,
    secret_refs: uniqueSecretRefs([...config.secret_refs, ...secretRefs]),
  });
}

function mapChecks(
  traceChecks: readonly BenchmarkCheckId[],
  extraChecks: readonly BenchmarkCheckId[],
): BenchmarkCheckId[] {
  return [...new Set([...traceChecks, ...extraChecks])];
}

function resolveScenarioAgentKey(
  suite: LiveBenchmarkSuiteSpec,
  scenario: LiveBenchmarkScenarioSpec,
  override: string | undefined,
): string {
  return override ?? scenario.environment.agent_key ?? suite.defaults.agent_key ?? "default";
}

function requireModelId(config: { model: string | null }, label: string): string {
  if (config.model) return config.model;
  throw new Error(`${label} requires a primary model`);
}

async function ensureTempAgent(
  http: BenchmarkHttpClient,
  sourceAgentKey: string,
  tempAgentKey: string,
  secretRefs: readonly AgentSecretReference[],
  modelOverride?: string,
): Promise<string> {
  const source = await http.agents.get(sourceAgentKey);
  await http.agents.create({
    agent_key: tempAgentKey,
    config: mergeAgentConfig(source.config, secretRefs, modelOverride),
    reason: `benchmark clone of ${sourceAgentKey}`,
  });
  return tempAgentKey;
}

async function createJudgeAgent(
  http: BenchmarkHttpClient,
  suiteId: string,
  model: string,
): Promise<string> {
  const agentKey = createTempAgentKey("benchmark-judge", suiteId);
  await http.agents.create({
    agent_key: agentKey,
    config: createBenchmarkJudgeConfig(model),
    reason: "benchmark judge",
  });
  return agentKey;
}

async function deleteAgentIfPresent(http: BenchmarkHttpClient, agentKey: string): Promise<void> {
  try {
    await http.agents.delete(agentKey);
  } catch {
    // best-effort cleanup
  }
}

async function createConversation(
  ws: TyrumClient,
  agentKey: string,
  channel: string,
): Promise<WsConversationCreateResultT["conversation"]> {
  const created = await ws.requestDynamic(
    "conversation.create",
    { agent_key: agentKey, channel },
    WsConversationCreateResult,
  );
  return created.conversation;
}

function resolveConversationKey(conversationId: string): string {
  return conversationId;
}

async function seedScenarioConversations(
  ws: TyrumClient,
  agentKey: string,
  scenario: LiveBenchmarkScenarioSpec,
  timeoutMs: number,
): Promise<void> {
  for (const seededConversation of scenario.seed.conversations) {
    const conversation = await createConversation(ws, agentKey, seededConversation.channel);
    const conversationKey = resolveConversationKey(conversation.conversation_id);
    await sendPromptAndCollectTrace(
      ws,
      conversation,
      conversationKey,
      seededConversation.message,
      timeoutMs,
      false,
    );
  }
}

async function runJudge(
  ws: TyrumClient,
  judgeAgentKey: string,
  input: BenchmarkJudgeInputT,
  timeoutMs: number,
): Promise<BenchmarkJudgeVerdict> {
  const conversation = await createConversation(ws, judgeAgentKey, "ui");
  const conversationKey = resolveConversationKey(conversation.conversation_id);
  const trace = await sendPromptAndCollectTrace(
    ws,
    conversation,
    conversationKey,
    buildBenchmarkJudgePrompt(input),
    timeoutMs,
    false,
  );

  if (!trace.finalReply) {
    throw new Error("judge did not return a final reply");
  }
  return parseBenchmarkJudgeVerdict(trace.finalReply);
}

function deriveExtraChecks(scenario: LiveBenchmarkScenarioSpec): BenchmarkCheckId[] {
  const checks: BenchmarkCheckId[] = [];
  if (scenario.environment.browser_required) checks.push("browser_used");
  if (scenario.environment.sandbox_request_required) checks.push("sandbox_requested");
  return checks;
}

function mapJudgeVerdictToStatus(
  verdict: BenchmarkJudgeVerdict,
): BenchmarkScenarioRunReportT["status"] {
  if (verdict.verdict === "pass") return "passed";
  if (verdict.verdict === "fail") return "failed";
  return "inconclusive";
}

function computeSuiteStatus(
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

function createScenarioJudgeInput(
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

async function maybeCheckDesktopHostAvailability(
  http: BenchmarkHttpClient,
  scenario: LiveBenchmarkScenarioSpec,
): Promise<void> {
  if (!scenario.environment.sandbox_request_required) {
    return;
  }
  const hosts = await http.desktopEnvironmentHosts.list();
  if (hosts.hosts.some(isDesktopEnvironmentHostAvailable)) {
    return;
  }
  throw new Error("no healthy desktop environment host is available for sandbox-required scenario");
}

async function runScenarioOnce(options: RunScenarioOptions): Promise<BenchmarkScenarioRunReportT> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const runAgentKey = createTempAgentKey(
    "benchmark-run",
    options.suite.suite_id,
    options.scenario.id,
  );
  const errors: string[] = [];

  try {
    await maybeCheckDesktopHostAvailability(options.http, options.scenario);
    await ensureTempAgent(
      options.http,
      options.targetAgentKey,
      runAgentKey,
      options.scenario.seed.secret_refs,
      options.modelOverride,
    );
    await seedScenarioConversations(
      options.ws,
      runAgentKey,
      options.scenario,
      options.turnTimeoutMs,
    );
    const conversation = await createConversation(
      options.ws,
      runAgentKey,
      options.scenario.prompt.channel,
    );
    const conversationKey = resolveConversationKey(conversation.conversation_id);
    const trace = await sendPromptAndCollectTrace(
      options.ws,
      conversation,
      conversationKey,
      options.scenario.prompt.message,
      options.turnTimeoutMs,
      options.scenario.environment.approval_mode === "must_request_autoapprove",
    );
    const judgeInput = createScenarioJudgeInput(options.suite, options.scenario, trace);
    const captureIntegrityErrors = getTraceCaptureIntegrityErrors(trace);
    if (captureIntegrityErrors.length > 0) {
      errors.push(...captureIntegrityErrors);
      throw new BenchmarkInfrastructureError(captureIntegrityErrors.join("; "), {
        artifacts: judgeInput.artifacts,
        missingArtifacts: judgeInput.missing_artifacts,
        traceSummary: judgeInput.trace_summary,
      });
    }
    const judgeVerdict = await runJudge(
      options.ws,
      options.judgeAgentKey,
      judgeInput,
      options.turnTimeoutMs,
    );
    const completedAt = new Date().toISOString();

    return BenchmarkScenarioRunReport.parse({
      suite_id: options.suite.suite_id,
      scenario_id: options.scenario.id,
      repeat_index: options.repeatIndex,
      status: mapJudgeVerdictToStatus(judgeVerdict),
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: Date.now() - startedMs,
      trace_summary: judgeInput.trace_summary,
      artifacts: judgeInput.artifacts,
      missing_artifacts: judgeInput.missing_artifacts,
      judge_input: judgeInput,
      judge_verdict: judgeVerdict,
      errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!errors.includes(message)) {
      errors.push(message);
    }
    const infrastructureError = error instanceof BenchmarkInfrastructureError ? error : null;
    return BenchmarkScenarioRunReport.parse({
      suite_id: options.suite.suite_id,
      scenario_id: options.scenario.id,
      repeat_index: options.repeatIndex,
      status: "infrastructure_error",
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedMs,
      trace_summary: infrastructureError?.traceSummary ?? null,
      artifacts: infrastructureError?.artifacts ?? {},
      missing_artifacts: infrastructureError?.missingArtifacts ?? [],
      judge_input: null,
      judge_verdict: null,
      errors,
    });
  } finally {
    await deleteAgentIfPresent(options.http, runAgentKey);
  }
}

async function writeReportIfRequested(
  outputDir: string | undefined,
  report: BenchmarkSuiteRunReportT,
): Promise<void> {
  if (!outputDir) return;
  await mkdir(outputDir, { recursive: true });
  const fileName = `${sanitizeKeyPart(report.suite_id)}-${Date.now()}.json`;
  await writeFile(join(outputDir, fileName), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function runBenchmarkSuite(
  home: string,
  request: BenchmarkRunRequest,
): Promise<BenchmarkSuiteRunReportT> {
  const parsedRequest = BenchmarkRunRequest.parse(request);
  const { suite } = await loadBenchmarkSuiteFromFile(parsedRequest.suite_path);
  const session = await createBenchmarkOperatorSession(home);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const repeatCount = parsedRequest.repeat ?? suite.defaults.repeat_count;
  const scenarios = parsedRequest.scenario_id
    ? suite.scenarios.filter(
        (scenario: LiveBenchmarkScenarioSpec) => scenario.id === parsedRequest.scenario_id,
      )
    : suite.scenarios;

  if (parsedRequest.scenario_id && scenarios.length === 0) {
    session.close();
    throw new Error(
      `scenario '${parsedRequest.scenario_id}' was not found in suite '${suite.suite_id}'`,
    );
  }

  const judgeAgentKey = await createJudgeAgent(
    session.http,
    suite.suite_id,
    requireModelId(parsedRequest.judge_model, "judge_model"),
  );

  try {
    const scenarioRuns: BenchmarkScenarioRunReportT[] = [];
    for (const scenario of scenarios) {
      for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
        scenarioRuns.push(
          await runScenarioOnce({
            http: session.http,
            ws: session.ws,
            suite,
            scenario,
            repeatIndex,
            modelOverride: parsedRequest.model
              ? requireModelId(parsedRequest.model, "model")
              : undefined,
            targetAgentKey: resolveScenarioAgentKey(suite, scenario, parsedRequest.agent_key),
            judgeAgentKey,
            turnTimeoutMs: suite.defaults.turn_timeout_ms,
          }),
        );
      }
    }

    const report = BenchmarkSuiteRunReport.parse({
      suite_id: suite.suite_id,
      status: computeSuiteStatus(scenarioRuns),
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedMs,
      scenario_runs: scenarioRuns,
    });
    await writeReportIfRequested(parsedRequest.output_dir, report);
    return report;
  } finally {
    await deleteAgentIfPresent(session.http, judgeAgentKey);
    session.close();
  }
}
