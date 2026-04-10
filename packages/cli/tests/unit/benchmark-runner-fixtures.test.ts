import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

function createTrace(input?: {
  finalReply?: string | null;
  toolEvents?: Array<{
    conversation_id: string;
    thread_id: string;
    tool_call_id: string;
    tool_id: string;
    status: "completed" | "failed";
    summary: string;
  }>;
}) {
  return {
    approvalEvents: [],
    captureDiagnostics: {
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
      events: [],
    },
  };
}

function createSession() {
  let conversationIndex = 0;
  return {
    config: {
      gateway_url: "http://127.0.0.1:8788",
      auth_token: "tenant-admin-token",
    },
    close: vi.fn(),
    http: {
      agents: {
        get: vi.fn().mockResolvedValue({
          config: AgentConfig.parse({
            model: { model: "openai/gpt-5.4" },
            mcp: {
              default_mode: "deny",
              allow: ["memory"],
              deny: [],
              pre_turn_tools: ["mcp.memory.seed"],
              server_settings: {},
            },
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
      toolRegistry: {
        list: vi.fn().mockResolvedValue({
          status: "ok",
          tools: [],
        }),
      },
      desktopEnvironmentHosts: {
        list: vi.fn().mockResolvedValue({
          hosts: [
            {
              healthy: true,
              docker_available: true,
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
}

async function writeWeatherSuiteFile(): Promise<{ homeDir: string; suitePath: string }> {
  const homeDir = await mkdtemp(join(tmpdir(), "tyrum-benchmark-runner-weather-"));
  const suitePath = join(homeDir, "suite.yaml");
  await writeFile(
    suitePath,
    [
      "version: 1",
      "suite_id: weather-live-v1",
      "title: Weather Live Benchmarks",
      "defaults:",
      "  turn_timeout_ms: 1000",
      "  run_timeout_ms: 2000",
      "  repeat_count: 1",
      "  tool_order_matters: false",
      "  verdict_policy: judge_only",
      "fixtures:",
      "  - id: weather",
      "    type: weather_service",
      "    config:",
      "      tool_family: mcp.weather.",
      "scenarios:",
      "  - id: weather_at_current_location",
      "    category: weather",
      "    objective: Check weather",
      "    seed:",
      "      conversations: []",
      "      secret_refs: []",
      "    prompt:",
      "      channel: ui",
      "      message: Check the weather forecast at my current location.",
      "    environment:",
      "      fixtures: [weather]",
      "      required_tool_families: [tool.location.]",
      "      disallowed_tool_families: []",
      "      browser_required: false",
      "      sandbox_request_required: false",
      "      approval_mode: none",
      "      secret_policy: not_applicable",
      "    trace:",
      "      artifacts_required: [final_reply]",
      "      checks: [capability_usage_correct]",
      "",
    ].join("\n"),
    "utf8",
  );
  return { homeDir, suitePath };
}

async function writeMerchantSuiteFile(input?: {
  merchantBaseUrl?: string;
}): Promise<{ homeDir: string; suitePath: string }> {
  const homeDir = await mkdtemp(join(tmpdir(), "tyrum-benchmark-runner-merchant-"));
  const suitePath = join(homeDir, "suite.yaml");
  const merchantConfigLines = input?.merchantBaseUrl
    ? ["    config:", `      base_url: ${input.merchantBaseUrl}`]
    : ["    config:", "      description: Sandbox-reachable benchmark merchant site."];
  await writeFile(
    suitePath,
    [
      "version: 1",
      "suite_id: commerce-live-v1",
      "title: Commerce Live Benchmarks",
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
      "  - id: merchant",
      "    type: merchant_site",
      ...merchantConfigLines,
      "  - id: approvals",
      "    type: approval_driver",
      "    config:",
      "      mode: auto_approve_requested_only",
      "scenarios:",
      "  - id: order_local_pizza_via_browser",
      "    category: commerce",
      "    objective: Order pizza",
      "    seed:",
      "      conversations: []",
      "      secret_refs:",
      "        - secret_ref_id: card-number",
      "          allowed_tool_ids: [tool.secret.copy-to-node-clipboard]",
      "    prompt:",
      "      channel: ui",
      "      message: Order my pizza.",
      "    environment:",
      "      fixtures: [desktop, merchant, approvals]",
      "      required_tool_families: [sandbox., tool.browser., tool.secret.]",
      "      disallowed_tool_families: []",
      "      browser_required: true",
      "      sandbox_request_required: true",
      "      approval_mode: must_request_autoapprove",
      "      secret_policy: refs_only",
      "    trace:",
      "      artifacts_required: [final_reply]",
      "      checks: [grounded_success]",
      "",
    ].join("\n"),
    "utf8",
  );
  return { homeDir, suitePath };
}

describe("runBenchmarkSuite fixture wiring", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    createBenchmarkOperatorSessionMock.mockReset();
    sendPromptAndCollectTraceMock.mockReset();
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("adds MCP server access required by benchmark fixtures to the cloned agent config", async () => {
    const { homeDir, suitePath } = await writeWeatherSuiteFile();
    tempDirs.push(homeDir);
    const session = createSession();
    session.http.toolRegistry.list.mockResolvedValue({
      status: "ok",
      tools: [
        {
          source: "mcp",
          canonical_id: "mcp.weather.forecast",
          description: "Weather forecast",
          effect: "read_only",
          effective_exposure: { enabled: true, reason: "enabled" },
          family: "mcp",
          backing_server: {
            id: "weather",
            name: "Weather",
            transport: "remote",
            url: "https://weather.example.test/mcp",
          },
        },
      ],
    });
    createBenchmarkOperatorSessionMock.mockResolvedValue(session);
    sendPromptAndCollectTraceMock
      .mockResolvedValueOnce(createTrace({ finalReply: "Forecast ready" }))
      .mockResolvedValueOnce(
        createTrace({
          finalReply:
            '{"verdict":"pass","confidence":"high","summary":"done","checks":[{"id":"capability_usage_correct","outcome":"pass","rationale":"ok","evidence_refs":["tool:1"]}]}',
        }),
      );

    const report = await runBenchmarkSuite(homeDir, {
      suite_path: suitePath,
      judge_model: { model: "openai/gpt-5.4-mini" },
    });

    expect(report.status).toBe("passed");
    expect(session.http.agents.create.mock.calls[1]?.[0]).toMatchObject({
      config: {
        mcp: {
          default_mode: "deny",
          allow: ["memory", "weather"],
        },
      },
    });
  });

  it("returns an infrastructure error when a required MCP family is unavailable on the gateway", async () => {
    const { homeDir, suitePath } = await writeWeatherSuiteFile();
    tempDirs.push(homeDir);
    const session = createSession();
    session.http.toolRegistry.list.mockResolvedValue({
      status: "ok",
      tools: [],
    });
    createBenchmarkOperatorSessionMock.mockResolvedValue(session);

    const report = await runBenchmarkSuite(homeDir, {
      suite_path: suitePath,
      judge_model: { model: "openai/gpt-5.4-mini" },
    });

    expect(report.status).toBe("infrastructure_error");
    expect(report.scenario_runs[0]?.status).toBe("infrastructure_error");
    expect(report.scenario_runs[0]?.errors[0]).toContain(
      "required MCP tool family 'mcp.weather.' is not available on this gateway",
    );
    expect(sendPromptAndCollectTraceMock).not.toHaveBeenCalled();
  });

  it("injects a local benchmark merchant URL and fixture instructions into the scenario prompt", async () => {
    const { homeDir, suitePath } = await writeMerchantSuiteFile();
    tempDirs.push(homeDir);
    const session = createSession();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ public_base_url: "https://desktop-ron.tail5b753a.ts.net" }),
      }),
    );
    createBenchmarkOperatorSessionMock.mockResolvedValue(session);
    sendPromptAndCollectTraceMock
      .mockResolvedValueOnce(createTrace({ finalReply: "Order placed" }))
      .mockResolvedValueOnce(
        createTrace({
          finalReply:
            '{"verdict":"pass","confidence":"high","summary":"done","checks":[{"id":"grounded_success","outcome":"pass","rationale":"ok","evidence_refs":["tool:1"]}]}',
        }),
      );

    const report = await runBenchmarkSuite(homeDir, {
      suite_path: suitePath,
      judge_model: { model: "openai/gpt-5.4-mini" },
    });

    expect(report.status).toBe("passed");
    expect(sendPromptAndCollectTraceMock.mock.calls[0]?.[3]).toContain(
      "https://desktop-ron.tail5b753a.ts.net/benchmarks/merchant",
    );
    expect(sendPromptAndCollectTraceMock.mock.calls[0]?.[3]).toContain(
      "Do not use search engines or third-party delivery marketplaces.",
    );
    expect(sendPromptAndCollectTraceMock.mock.calls[0]?.[3]).toContain(
      "Request approval immediately before placing the final order.",
    );
  });

  it("treats bracketed IPv6 gateway URLs as loopback when resolving the benchmark merchant site", async () => {
    const { homeDir, suitePath } = await writeMerchantSuiteFile();
    tempDirs.push(homeDir);
    const session = createSession();
    session.config.gateway_url = "http://[::1]:8788";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ public_base_url: "https://desktop-ron.tail5b753a.ts.net" }),
      }),
    );
    createBenchmarkOperatorSessionMock.mockResolvedValue(session);
    sendPromptAndCollectTraceMock
      .mockResolvedValueOnce(createTrace({ finalReply: "Order placed" }))
      .mockResolvedValueOnce(
        createTrace({
          finalReply:
            '{"verdict":"pass","confidence":"high","summary":"done","checks":[{"id":"grounded_success","outcome":"pass","rationale":"ok","evidence_refs":["tool:1"]}]}',
        }),
      );

    const report = await runBenchmarkSuite(homeDir, {
      suite_path: suitePath,
      judge_model: { model: "openai/gpt-5.4-mini" },
    });

    expect(report.status).toBe("passed");
    expect(sendPromptAndCollectTraceMock.mock.calls[0]?.[3]).toContain(
      "https://desktop-ron.tail5b753a.ts.net/benchmarks/merchant",
    );
    expect(sendPromptAndCollectTraceMock.mock.calls[0]?.[3]).not.toContain(
      "http://[::1]:8788/benchmarks/merchant",
    );
  });

  it("prefers an explicit merchant fixture base URL when provided", async () => {
    const { homeDir, suitePath } = await writeMerchantSuiteFile({
      merchantBaseUrl: "https://merchant.example.test",
    });
    tempDirs.push(homeDir);
    const session = createSession();
    createBenchmarkOperatorSessionMock.mockResolvedValue(session);
    sendPromptAndCollectTraceMock
      .mockResolvedValueOnce(createTrace({ finalReply: "Order placed" }))
      .mockResolvedValueOnce(
        createTrace({
          finalReply:
            '{"verdict":"pass","confidence":"high","summary":"done","checks":[{"id":"grounded_success","outcome":"pass","rationale":"ok","evidence_refs":["tool:1"]}]}',
        }),
      );

    const report = await runBenchmarkSuite(homeDir, {
      suite_path: suitePath,
      judge_model: { model: "openai/gpt-5.4-mini" },
    });

    expect(report.status).toBe("passed");
    expect(sendPromptAndCollectTraceMock.mock.calls[0]?.[3]).toContain(
      "https://merchant.example.test/benchmarks/merchant",
    );
  });
});
