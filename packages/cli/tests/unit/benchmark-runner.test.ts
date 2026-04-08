import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentConfig } from "@tyrum/contracts";

const { createBenchmarkOperatorSessionMock, sendPromptAndCollectTraceMock } = vi.hoisted(() => ({
  createBenchmarkOperatorSessionMock: vi.fn(),
  sendPromptAndCollectTraceMock: vi.fn(),
}));

vi.mock("../../src/benchmark/operator-session.js", () => ({
  createBenchmarkOperatorSession: createBenchmarkOperatorSessionMock,
}));

vi.mock("../../src/benchmark/trace-capture.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/benchmark/trace-capture.js")>(
    "../../src/benchmark/trace-capture.js",
  );
  return {
    ...actual,
    sendPromptAndCollectTrace: sendPromptAndCollectTraceMock,
  };
});

import { runBenchmarkSuite } from "../../src/benchmark/runner.js";

function createAssistantTranscriptEvent(eventId: string, text: string) {
  return {
    kind: "message",
    event_id: eventId,
    payload: {
      message: {
        role: "assistant",
        parts: [{ type: "text", text }],
      },
    },
  };
}

function createTrace(input?: {
  captureDiagnostics?: {
    liveApprovalEvents: number;
    liveContextReports: number;
    liveToolEvents: number;
    transcriptApprovalEvents: number;
    transcriptContextReports: number;
    transcriptToolEvents: number;
  };
  finalReply?: string | null;
  toolEvents?: Array<{
    conversation_id: string;
    thread_id: string;
    tool_call_id: string;
    tool_id: string;
    status: "completed" | "failed";
    summary: string;
  }>;
  transcriptEvents?: Array<{
    kind: string;
    event_id: string;
    payload: Record<string, unknown>;
  }>;
}) {
  return {
    approvalEvents: [],
    captureDiagnostics: input?.captureDiagnostics ?? {
      liveApprovalEvents: 0,
      liveContextReports: 0,
      liveToolEvents: 0,
      transcriptApprovalEvents: 0,
      transcriptContextReports: 0,
      transcriptToolEvents: 0,
    },
    contextReports: [],
    conversation: { messages: [] },
    conversationKey: "conversation-key",
    finalReply: input?.finalReply ?? "done",
    streamEvents: [],
    toolEvents: input?.toolEvents ?? [],
    transcript: {
      events: input?.transcriptEvents ?? [],
    },
  };
}

function createSession(input?: { healthyDesktopHost?: boolean }) {
  let conversationIndex = 0;
  const session = {
    close: vi.fn(),
    http: {
      agents: {
        get: vi.fn().mockResolvedValue({
          config: AgentConfig.parse({
            model: { model: "openai/gpt-5.4" },
            secret_refs: [
              {
                secret_ref_id: "card-number",
                allowed_tool_ids: ["tool.secret.copy-to-node-clipboard"],
              },
            ],
          }),
        }),
        create: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      desktopEnvironmentHosts: {
        list: vi.fn().mockResolvedValue({
          hosts: [
            {
              healthy: input?.healthyDesktopHost ?? true,
              docker_available: input?.healthyDesktopHost ?? true,
            },
          ],
        }),
      },
    },
    ws: {
      requestDynamic: vi.fn(async (type: string) => {
        if (type !== "conversation.create") {
          throw new Error(`unexpected ws request: ${type}`);
        }
        conversationIndex += 1;
        return {
          conversation: {
            conversation_id: `conversation-${String(conversationIndex)}`,
          },
        };
      }),
    },
  };

  return session;
}

async function writeSuiteFile(input: {
  sandboxRequired?: boolean;
  seedConversation?: boolean;
}): Promise<{ homeDir: string; suitePath: string }> {
  const homeDir = await mkdtemp(join(tmpdir(), "tyrum-benchmark-runner-"));
  const suitePath = join(homeDir, "suite.yaml");
  await writeFile(
    suitePath,
    [
      "version: 1",
      "suite_id: core-live-v1",
      "title: Core Live Benchmarks",
      "defaults:",
      "  turn_timeout_ms: 1000",
      "  run_timeout_ms: 2000",
      "  repeat_count: 1",
      "  tool_order_matters: false",
      "  verdict_policy: judge_only",
      "fixtures:",
      "  - id: desktop",
      "    type: desktop_environment_host",
      "    config: {}",
      "scenarios:",
      "  - id: order_local_pizza_via_browser",
      "    category: commerce",
      "    objective: Order pizza",
      "    seed:",
      input.seedConversation
        ? "      conversations:\n        - channel: ui\n          message: My favorite pizza is pepperoni."
        : "      conversations: []",
      "      secret_refs:",
      "        - secret_ref_id: card-number",
      "          allowed_tool_ids: [tool.secret.copy-to-node-clipboard]",
      "        - secret_ref_id: card-cvc",
      "          allowed_tool_ids: [tool.secret.copy-to-node-clipboard]",
      "    prompt:",
      "      channel: ui",
      "      message: Order my pizza.",
      "    environment:",
      "      fixtures: [desktop]",
      "      required_tool_families: [sandbox., tool.browser.]",
      "      disallowed_tool_families: [mcp.weather.]",
      "      browser_required: true",
      `      sandbox_request_required: ${input.sandboxRequired ? "true" : "false"}`,
      "      approval_mode: must_request_autoapprove",
      "      secret_policy: refs_only",
      "    trace:",
      "      artifacts_required: [final_reply]",
      "      checks: [capability_usage_correct]",
      "",
    ].join("\n"),
    "utf8",
  );
  return { homeDir, suitePath };
}

describe("runBenchmarkSuite", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    createBenchmarkOperatorSessionMock.mockReset();
    sendPromptAndCollectTraceMock.mockReset();
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runs a suite successfully, writes a report, and clones the agent config", async () => {
    const { homeDir, suitePath } = await writeSuiteFile({
      sandboxRequired: true,
      seedConversation: true,
    });
    tempDirs.push(homeDir);
    const outputDir = join(homeDir, "reports");
    const session = createSession({ healthyDesktopHost: true });
    createBenchmarkOperatorSessionMock.mockResolvedValue(session);
    sendPromptAndCollectTraceMock
      .mockResolvedValueOnce(createTrace({ finalReply: "remembered" }))
      .mockResolvedValueOnce(
        createTrace({
          finalReply: "Order placed",
          toolEvents: [
            {
              conversation_id: "conversation-2",
              thread_id: "thread-1",
              tool_call_id: "tool-1",
              tool_id: "sandbox.request",
              status: "completed",
              summary: "managed desktop attached",
            },
            {
              conversation_id: "conversation-2",
              thread_id: "thread-1",
              tool_call_id: "tool-2",
              tool_id: "tool.browser.navigate",
              status: "completed",
              summary: "navigated to merchant",
            },
          ],
          transcriptEvents: [createAssistantTranscriptEvent("assistant-1", "Order placed")],
        }),
      )
      .mockResolvedValueOnce(
        createTrace({
          finalReply:
            '{"verdict":"pass","confidence":"high","summary":"done","checks":[{"id":"capability_usage_correct","outcome":"pass","rationale":"ok","evidence_refs":["tool:1"]}]}',
          transcriptEvents: [createAssistantTranscriptEvent("judge-1", "pass")],
        }),
      );

    const report = await runBenchmarkSuite(homeDir, {
      suite_path: suitePath,
      judge_model: { model: "openai/gpt-5.4-mini" },
      model: { model: "openai/gpt-5.4" },
      output_dir: outputDir,
      agent_key: "custom-agent",
    });

    expect(report.status).toBe("passed");
    expect(session.http.agents.get).toHaveBeenCalledWith("custom-agent");
    expect(session.http.agents.create).toHaveBeenCalledTimes(2);
    expect(session.http.agents.create.mock.calls[1]?.[0]).toMatchObject({
      config: {
        model: { model: "openai/gpt-5.4" },
        secret_refs: [{ secret_ref_id: "card-number" }, { secret_ref_id: "card-cvc" }],
      },
      reason: "benchmark clone of custom-agent",
    });
    expect(session.http.desktopEnvironmentHosts.list).toHaveBeenCalledTimes(1);
    expect(session.close).toHaveBeenCalledTimes(1);

    const reportFiles = await readdir(outputDir);
    expect(reportFiles).toHaveLength(1);
    const persisted = JSON.parse(await readFile(join(outputDir, reportFiles[0] ?? ""), "utf8")) as {
      status: string;
    };
    expect(persisted.status).toBe("passed");
  });

  it("returns a failed suite status when the judge verdict fails", async () => {
    const { homeDir, suitePath } = await writeSuiteFile({
      sandboxRequired: false,
      seedConversation: false,
    });
    tempDirs.push(homeDir);
    const session = createSession({ healthyDesktopHost: true });
    createBenchmarkOperatorSessionMock.mockResolvedValue(session);
    sendPromptAndCollectTraceMock
      .mockResolvedValueOnce(createTrace({ finalReply: "Order placed" }))
      .mockResolvedValueOnce(
        createTrace({
          finalReply:
            '{"verdict":"fail","confidence":"medium","summary":"wrong merchant","checks":[{"id":"grounded_success","outcome":"fail","rationale":"wrong","evidence_refs":["tool:1"]}]}',
        }),
      );

    const report = await runBenchmarkSuite(homeDir, {
      suite_path: suitePath,
      judge_model: { model: "openai/gpt-5.4-mini" },
    });

    expect(report.status).toBe("failed");
    expect(report.scenario_runs[0]?.status).toBe("failed");
  });

  it("returns an infrastructure error when live trace capture is inconsistent", async () => {
    const { homeDir, suitePath } = await writeSuiteFile({
      sandboxRequired: false,
      seedConversation: false,
    });
    tempDirs.push(homeDir);
    const session = createSession({ healthyDesktopHost: true });
    createBenchmarkOperatorSessionMock.mockResolvedValue(session);
    sendPromptAndCollectTraceMock.mockResolvedValueOnce(
      createTrace({
        captureDiagnostics: {
          liveApprovalEvents: 0,
          liveContextReports: 0,
          liveToolEvents: 0,
          transcriptApprovalEvents: 0,
          transcriptContextReports: 0,
          transcriptToolEvents: 1,
        },
        finalReply: "Order placed",
      }),
    );

    const report = await runBenchmarkSuite(homeDir, {
      suite_path: suitePath,
      judge_model: { model: "openai/gpt-5.4-mini" },
    });

    expect(report.status).toBe("infrastructure_error");
    expect(report.scenario_runs[0]?.status).toBe("infrastructure_error");
    expect(report.scenario_runs[0]?.trace_summary).not.toBeNull();
    expect(report.scenario_runs[0]?.errors[0]).toContain("live tool capture missed 1");
  });

  it("throws when a requested scenario is not present in the suite", async () => {
    const { homeDir, suitePath } = await writeSuiteFile({
      sandboxRequired: false,
      seedConversation: false,
    });
    tempDirs.push(homeDir);
    const session = createSession({ healthyDesktopHost: true });
    createBenchmarkOperatorSessionMock.mockResolvedValue(session);

    await expect(
      runBenchmarkSuite(homeDir, {
        suite_path: suitePath,
        judge_model: { model: "openai/gpt-5.4-mini" },
        scenario_id: "missing-scenario",
      }),
    ).rejects.toThrow("scenario 'missing-scenario' was not found in suite 'core-live-v1'");

    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("closes the operator session when judge agent creation fails", async () => {
    const { homeDir, suitePath } = await writeSuiteFile({
      sandboxRequired: false,
      seedConversation: false,
    });
    tempDirs.push(homeDir);
    const session = createSession({ healthyDesktopHost: true });
    session.http.agents.create.mockRejectedValueOnce(new Error("judge create failed"));
    createBenchmarkOperatorSessionMock.mockResolvedValue(session);

    await expect(
      runBenchmarkSuite(homeDir, {
        suite_path: suitePath,
        judge_model: { model: "openai/gpt-5.4-mini" },
      }),
    ).rejects.toThrow("judge create failed");

    expect(session.http.agents.delete).not.toHaveBeenCalled();
    expect(sendPromptAndCollectTraceMock).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(1);
  });
});
