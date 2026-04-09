import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBenchmarkSuiteFromFile } from "../../src/benchmark/load-suite.js";
import {
  buildBenchmarkJudgePrompt,
  parseBenchmarkJudgeVerdict,
} from "../../src/benchmark/judge.js";
import {
  getTraceCaptureIntegrityErrors,
  sendPromptAndCollectTrace,
} from "../../src/benchmark/runner.js";
import { summarizeBenchmarkTrace } from "../../src/benchmark/trace-normalizer.js";

describe("benchmark support", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("loads a benchmark suite from YAML", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-benchmark-suite-"));
    const suitePath = join(tempDir, "suite.yaml");
    await writeFile(
      suitePath,
      [
        "version: 1",
        "suite_id: core-live-v1",
        "title: Core Live Benchmarks",
        "fixtures:",
        "  - id: desktop-host",
        "    type: desktop_environment_host",
        "    config: {}",
        "scenarios:",
        "  - id: weather_at_current_location",
        "    category: weather",
        "    objective: Report the forecast for the user's current location.",
        "    seed: { conversations: [], secret_refs: [] }",
        "    prompt:",
        "      channel: ui",
        "      message: Check the weather forecast at my current location.",
        "    environment:",
        "      fixtures: [desktop-host]",
        "      required_tool_families: [tool.location.]",
        "      disallowed_tool_families: []",
        "      browser_required: false",
        "      sandbox_request_required: false",
        "      approval_mode: none",
        "      secret_policy: not_applicable",
        "    trace:",
        "      artifacts_required: [final_reply]",
        "      checks: [capability_usage_correct, grounded_success]",
        "",
      ].join("\n"),
      "utf8",
    );

    const loaded = await loadBenchmarkSuiteFromFile(suitePath);

    expect(loaded.suite.suite_id).toBe("core-live-v1");
    expect(loaded.suite.scenarios[0]?.trace.checks).toContain("grounded_success");
  });

  it("summarizes tool, browser, sandbox, and approval metrics", () => {
    const summary = summarizeBenchmarkTrace({
      toolEvents: [
        {
          conversation_id: "conv-1",
          thread_id: "thread-1",
          tool_call_id: "tool-1",
          tool_id: "sandbox.request",
          status: "completed",
          summary: "managed desktop attached",
        },
        {
          conversation_id: "conv-1",
          thread_id: "thread-1",
          tool_call_id: "tool-2",
          tool_id: "tool.browser.navigate",
          status: "completed",
          summary: "navigated",
        },
        {
          conversation_id: "conv-1",
          thread_id: "thread-1",
          tool_call_id: "tool-3",
          tool_id: "tool.secret.copy-to-node-clipboard",
          status: "failed",
          summary: "failed",
          error: "node missing",
        },
      ],
      contextReports: [
        {
          context_report_id: "550e8400-e29b-41d4-a716-446655440000",
          generated_at: "2026-04-08T09:00:00.000Z",
          conversation_id: "conv-1",
          channel: "ui",
          thread_id: "thread-1",
          agent_id: "default",
          workspace_id: "default",
          system_prompt: { chars: 10, sections: [] },
          user_parts: [],
          selected_tools: [],
          tool_schema_top: [],
          tool_schema_total_chars: 0,
          enabled_skills: [],
          mcp_servers: [],
          memory: { keyword_hits: 1, semantic_hits: 2 },
          pre_turn_tools: [],
          tool_calls: [],
          injected_files: [],
        },
      ],
      approvals: [
        {
          approval_id: "550e8400-e29b-41d4-a716-446655440111",
          approval_key: "approval-1",
          kind: "policy",
          status: "approved",
          prompt: "Approve checkout",
          motivation: "Payment required",
          created_at: "2026-04-08T09:00:00.000Z",
          latest_review: null,
        },
      ],
      assistantMessages: [
        { ref: "transcript:1", text: "What is your address?" },
        { ref: "transcript:2", text: "I cannot do that without a browser." },
      ],
      finalReply: "Done",
      requiredToolFamilies: ["sandbox.", "tool.browser."],
      disallowedToolFamilies: ["mcp.weather."],
      seededFacts: ["My home address is 123 Benchmark Lane."],
    });

    expect(summary.tools.calls_total).toBe(3);
    expect(summary.browser.used).toBe(true);
    expect(summary.sandbox.requested).toBe(true);
    expect(summary.secrets.secret_tool_calls).toBe(1);
    expect(summary.messages.assistant_question_count).toBe(1);
  });

  it("builds and parses judge prompts and verdicts", () => {
    const prompt = buildBenchmarkJudgePrompt({
      suite: { suite_id: "suite", title: "Suite" },
      scenario: {
        id: "weather",
        category: "weather",
        objective: "Check weather",
        seed: { conversations: [], secret_refs: [] },
        prompt: { channel: "ui", message: "Weather?" },
        environment: {
          fixtures: [],
          required_tool_families: ["tool.location."],
          disallowed_tool_families: [],
          browser_required: false,
          sandbox_request_required: false,
          approval_mode: "none",
          secret_policy: "not_applicable",
        },
        trace: { artifacts_required: ["final_reply"], checks: ["capability_usage_correct"] },
      },
      trace_summary: {
        tools: {
          calls_total: 1,
          failed_calls: 0,
          repeated_failed_calls: 0,
          ids_used: ["tool.location.get"],
          families_used: ["tool.location."],
          required_families_missing: [],
          forbidden_families_used: [],
        },
        messages: {
          assistant_question_count: 0,
          assistant_question_messages: [],
          explicit_refusal_count: 0,
          explicit_refusal_messages: [],
          final_reply_present: true,
        },
        memory: {
          keyword_hits: 0,
          semantic_hits: 0,
          seeded_facts: [],
        },
        approvals: {
          requested: 0,
          approved: 0,
          denied: 0,
        },
        browser: { used: false, tool_calls: 0 },
        sandbox: { requested: false, attached: false, released: false },
        secrets: { secret_tool_calls: 0 },
      },
      trace_events: [],
      artifacts: { final_reply: { kind: "text", content: "Sunny" } },
      missing_artifacts: [],
      final_reply: "Sunny",
    });

    expect(prompt).toContain("Return JSON only");

    const verdict = parseBenchmarkJudgeVerdict(
      '{"verdict":"pass","confidence":"high","summary":"The agent used the location tool and answered correctly.","checks":[{"id":"capability_usage_correct","outcome":"pass","rationale":"The location tool was used.","evidence_refs":["tool:1"]}]}',
    );

    expect(verdict.verdict).toBe("pass");
    expect(verdict.checks).toHaveLength(1);
  });

  it("drops malformed judge checks while preserving the verdict", () => {
    const verdict = parseBenchmarkJudgeVerdict(
      '{"verdict":"fail","confidence":"high","summary":"The run failed checkout.","checks":[{"id":"checkout_completed","outcome":"fail","rationale":"No order confirmation was produced.","evidence_refs":["tool:2"]},{"id":"sandbox_attached","outcome":"fail","rationale":"The sandbox never attached.","evidence_refs":["tool:1"]}]}',
    );

    expect(verdict.verdict).toBe("fail");
    expect(verdict.checks).toEqual([
      {
        id: "checkout_completed",
        outcome: "fail",
        rationale: "No order confirmation was produced.",
        evidence_refs: ["tool:2"],
      },
    ]);
  });

  it("captures tool events that arrive before send resolves and shortly after stream completion", async () => {
    const handlers = new Map<string, Set<(event: unknown) => void>>();
    const emit = (type: string, event: unknown): void => {
      for (const handler of handlers.get(type) ?? []) {
        handler(event);
      }
    };
    const ws = {
      onDynamicEvent(type: string, handler: (event: unknown) => void) {
        const current = handlers.get(type) ?? new Set<(event: unknown) => void>();
        current.add(handler);
        handlers.set(type, current);
      },
      offDynamicEvent(type: string, handler: (event: unknown) => void) {
        handlers.get(type)?.delete(handler);
      },
      approvalResolve: vi.fn(async () => undefined),
      requestDynamic: vi.fn(async (type: string) => {
        if (type === "conversation.send") {
          emit("tool.lifecycle", {
            event_id: "tool-early",
            type: "tool.lifecycle",
            occurred_at: "2026-04-08T09:00:00.000Z",
            payload: {
              conversation_id: "conv-1",
              thread_id: "thread-1",
              tool_call_id: "tool-call-1",
              tool_id: "tool.location.get",
              status: "completed",
              summary: "resolved location",
            },
          });
          queueMicrotask(() => {
            emit("chat.ui-message.stream", {
              event_id: "stream-done",
              type: "chat.ui-message.stream",
              occurred_at: "2026-04-08T09:00:00.100Z",
              payload: { stream_id: "stream-1", stage: "done" },
            });
            setTimeout(() => {
              emit("tool.lifecycle", {
                event_id: "tool-late",
                type: "tool.lifecycle",
                occurred_at: "2026-04-08T09:00:00.150Z",
                payload: {
                  conversation_id: "conv-1",
                  thread_id: "thread-1",
                  tool_call_id: "tool-call-2",
                  tool_id: "tool.browser.navigate",
                  status: "completed",
                  summary: "navigated browser",
                },
              });
            }, 5);
          });
          return { stream_id: "stream-1" };
        }
        if (type === "conversation.get") {
          return {
            conversation: {
              conversation_id: "conv-1",
              messages: [
                {
                  id: "assistant-1",
                  role: "assistant",
                  parts: [{ type: "text", text: "Done" }],
                },
              ],
            },
          };
        }
        if (type === "transcript.get") {
          return {
            root_conversation_key: "conv-1",
            focus_conversation_key: "conv-1",
            conversations: [],
            events: [],
          };
        }
        throw new Error(`unexpected request type ${type}`);
      }),
    };

    const trace = await sendPromptAndCollectTrace(
      ws as never,
      { conversation_id: "conv-1" } as never,
      "conv-1",
      "Check the weather",
      1_000,
      false,
      20,
    );

    expect(trace.toolEvents.map((event) => event.tool_id)).toEqual([
      "tool.location.get",
      "tool.browser.navigate",
    ]);
  });

  it("backfills tool and context metrics from the durable transcript when live capture is empty", async () => {
    const handlers = new Map<string, Set<(event: unknown) => void>>();
    const ws = {
      onDynamicEvent(type: string, handler: (event: unknown) => void) {
        const current = handlers.get(type) ?? new Set<(event: unknown) => void>();
        current.add(handler);
        handlers.set(type, current);
      },
      offDynamicEvent(type: string, handler: (event: unknown) => void) {
        handlers.get(type)?.delete(handler);
      },
      approvalResolve: vi.fn(async () => undefined),
      requestDynamic: vi.fn(async (type: string) => {
        if (type === "conversation.send") {
          queueMicrotask(() => {
            for (const handler of handlers.get("chat.ui-message.stream") ?? []) {
              handler({
                event_id: "stream-done",
                type: "chat.ui-message.stream",
                occurred_at: "2026-04-08T09:00:00.100Z",
                payload: { stream_id: "stream-1", stage: "done" },
              });
            }
          });
          return { stream_id: "stream-1" };
        }
        if (type === "conversation.get") {
          return {
            conversation: {
              conversation_id: "conv-1",
              messages: [
                {
                  id: "assistant-1",
                  role: "assistant",
                  parts: [{ type: "text", text: "Done" }],
                },
              ],
            },
          };
        }
        if (type === "transcript.get") {
          return {
            root_conversation_key: "conv-1",
            focus_conversation_key: "conv-1",
            conversations: [],
            events: [
              {
                event_id: "tool_lifecycle:event-1",
                kind: "tool_lifecycle",
                occurred_at: "2026-04-08T09:00:00.050Z",
                conversation_key: "conv-1",
                payload: {
                  tool_event: {
                    conversation_id: "conv-1",
                    thread_id: "thread-1",
                    tool_call_id: "tool-call-1",
                    tool_id: "sandbox.request",
                    status: "completed",
                    summary: "attached desktop",
                  },
                },
              },
              {
                event_id: "context_report:report-1",
                kind: "context_report",
                occurred_at: "2026-04-08T09:00:00.060Z",
                conversation_key: "conv-1",
                payload: {
                  report: {
                    context_report_id: "550e8400-e29b-41d4-a716-446655440300",
                    generated_at: "2026-04-08T09:00:00.060Z",
                    conversation_id: "conv-1",
                    channel: "ui",
                    thread_id: "thread-1",
                    agent_id: "default",
                    workspace_id: "default",
                    system_prompt: { chars: 10, sections: [] },
                    user_parts: [],
                    selected_tools: [],
                    tool_schema_top: [],
                    tool_schema_total_chars: 0,
                    enabled_skills: [],
                    mcp_servers: [],
                    memory: { keyword_hits: 1, semantic_hits: 2 },
                    pre_turn_tools: [],
                    tool_calls: [],
                    injected_files: [],
                  },
                },
              },
            ],
          };
        }
        throw new Error(`unexpected request type ${type}`);
      }),
    };

    const trace = await sendPromptAndCollectTrace(
      ws as never,
      { conversation_id: "conv-1" } as never,
      "conv-1",
      "Order pizza",
      1_000,
      false,
      20,
    );

    expect(trace.toolEvents.map((event) => event.tool_id)).toEqual(["sandbox.request"]);
    expect(trace.contextReports[0]?.memory.semantic_hits).toBe(2);
    expect(trace.captureDiagnostics.transcriptToolEvents).toBe(1);
    expect(trace.captureDiagnostics.liveToolEvents).toBe(0);
  });

  it("flags transcript-only trace capture as an instrumentation failure", () => {
    const errors = getTraceCaptureIntegrityErrors({
      approvalEvents: [],
      captureDiagnostics: {
        liveApprovalEvents: 0,
        liveContextReports: 0,
        liveToolEvents: 0,
        transcriptApprovalEvents: 1,
        transcriptContextReports: 1,
        transcriptToolEvents: 1,
      },
      contextReports: [],
      conversation: {
        conversation_id: "conv-1",
        messages: [],
      },
      conversationKey: "conv-1",
      finalReply: "Done",
      streamEvents: [],
      toolEvents: [],
      transcript: {
        root_conversation_key: "conv-1",
        focus_conversation_key: "conv-1",
        conversations: [],
        events: [],
      },
    } as never);

    expect(errors).toEqual([
      "live tool capture missed 1 transcript-backed tool events",
      "live context capture missed 1 transcript-backed context reports",
      "live approval capture missed 1 transcript-backed approvals",
    ]);
  });
});
