import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import {
  makeContextReport,
  createToolSetBuilder,
  seedAgentConfig,
  teardownTestEnv,
  fetch404,
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  migrationsDir,
} from "./agent-runtime.test-helpers.js";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createStubLanguageModel } from "./stub-language-model.js";
import { awaitApprovalForToolExecution } from "../../src/modules/agent/runtime/tool-set-builder-helpers.js";

vi.mock("../../src/modules/agent/runtime/tool-set-builder-helpers.js", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../../src/modules/agent/runtime/tool-set-builder-helpers.js")
    >();
  return {
    ...original,
    awaitApprovalForToolExecution: vi.fn(original.awaitApprovalForToolExecution),
  };
});

describe("AgentRuntime - session lifecycle and policy", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("scopes session cleanup to the current agentId", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    await seedAgentConfig(container, {
      agentKey: "agent-1",
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: { enabled: [] },
        tools: { allow: [] },
        sessions: { ttl_days: 12, max_turns: 20 },
        memory: { markdown_enabled: false },
      },
    });

    const deleteSpy = vi.spyOn(container.sessionDal, "deleteExpired").mockResolvedValue(0);

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      agentId: "agent-1",
      languageModel: createStubLanguageModel("hello"),
      fetchImpl: fetch404,
    });

    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
    });

    expect(deleteSpy).toHaveBeenCalledWith(12, "agent-1");
  });

  it("reconciles MCP servers when MCP tools become disallowed", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    await mkdir(join(homeDir, "mcp/calendar"), { recursive: true });
    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: { enabled: ["calendar"] },
        tools: { allow: ["tool.fs.read", "mcp.*"] },
        sessions: { ttl_days: 30, max_turns: 20 },
        memory: { markdown_enabled: false },
      },
    });
    await writeFile(
      join(homeDir, "mcp/calendar/server.yml"),
      `id: calendar\nname: Calendar MCP\nenabled: true\ntransport: stdio\ncommand: node\nargs: []\n`,
      "utf-8",
    );

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
      fetchImpl: fetch404,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
    });

    expect(mcpManager.listToolDescriptors).toHaveBeenCalledTimes(1);
    expect(mcpManager.listToolDescriptors).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.objectContaining({ id: "calendar" })]),
    );

    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: { enabled: ["calendar"] },
        tools: { allow: ["tool.fs.read"] },
        sessions: { ttl_days: 30, max_turns: 20 },
        memory: { markdown_enabled: false },
      },
    });

    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello again",
    });

    expect(mcpManager.listToolDescriptors).toHaveBeenCalledTimes(2);
    expect(mcpManager.listToolDescriptors).toHaveBeenNthCalledWith(2, []);
  });

  it("shutdown calls McpManager.shutdown()", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
      fetchImpl: fetch404,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    await runtime.shutdown();
    expect(mcpManager.shutdown).toHaveBeenCalledTimes(1);
  });

  it("writes memory when assistant mentions secret handles", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("Use secret:my-key to reference a stored secret."),
      fetchImpl: fetch404,
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "how do I use secret handles?",
    });

    expect(result.reply).toContain("secret:my-key");
    expect(result.memory_written).toBe(true);
  });

  it("preserves legacy tool confirmation in policy observe-only mode", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => true,
      evaluateToolCall: vi.fn(async () => ({ decision: "deny" as const })),
    };

    const toolSetBuilder = createToolSetBuilder({ home: homeDir, container, policyService });

    vi.mocked(awaitApprovalForToolExecution).mockClear();
    const approvalSpy = vi.mocked(awaitApprovalForToolExecution).mockResolvedValue({
      approved: true,
      status: "approved",
      approvalId: "approval-1",
    });

    const toolDesc = {
      id: "tool.exec",
      description: "Execute shell commands on the local machine.",
      risk: "high" as const,
      requires_confirmation: true,
      keywords: [],
      inputSchema: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
        additionalProperties: false,
      },
    };

    const toolExecutor = {
      execute: vi.fn(async () => ({
        tool_call_id: "tc-test",
        output: "ok",
        error: undefined,
        provenance: undefined,
      })),
    };

    const usedTools = new Set<string>();
    const toolSet = toolSetBuilder.buildToolSet(
      [toolDesc],
      toolExecutor,
      usedTools,
      {
        planId: "plan-1",
        sessionId: "session-1",
        channel: "test",
        threadId: "thread-1",
      },
      makeContextReport(),
    );

    const res = await toolSet["tool.exec"]!.execute({ command: "echo hi" });

    expect(res).toBe("ok");
    expect(policyService.evaluateToolCall).toHaveBeenCalledTimes(1);
    expect(approvalSpy).toHaveBeenCalledTimes(1);
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
    expect(usedTools.has("tool.exec")).toBe(true);
  });

  it("rejects approvals that don't match tool_call_id during execution resume", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const policyService = {
      isEnabled: () => false,
      isObserveOnly: () => false,
      evaluateToolCall: vi.fn(),
    };

    const toolSetBuilder = createToolSetBuilder({ home: homeDir, container, policyService });

    const approval = await container.approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: "plan-1:step:0:tool_call:tc-other",
      kind: "workflow_step",
      prompt: "Approve tool.exec",
      context: {
        source: "agent-tool-execution",
        tool_id: "tool.exec",
        tool_call_id: "tc-other",
        tool_match_target: "echo hi",
      },
    });
    await container.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      decision: "approved",
    });

    const toolDesc = {
      id: "tool.exec",
      description: "Execute shell commands on the local machine.",
      risk: "high" as const,
      requires_confirmation: true,
      keywords: [],
      inputSchema: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
        additionalProperties: false,
      },
    };

    const toolExecutor = {
      execute: vi.fn(async () => ({
        tool_call_id: "tc-test",
        output: "ok",
        error: undefined,
        provenance: undefined,
      })),
    };

    const usedTools = new Set<string>();
    const toolSet = toolSetBuilder.buildToolSet(
      [toolDesc],
      toolExecutor,
      usedTools,
      {
        planId: "plan-1",
        sessionId: "session-1",
        channel: "test",
        threadId: "thread-1",
        execution: {
          runId: "run-1",
          stepIndex: 0,
          stepId: "step-1",
          stepApprovalId: approval.approval_id,
        },
      },
      makeContextReport(),
    );

    const res = await toolSet["tool.exec"]!.execute({ command: "echo hi" }, {
      toolCallId: "tc-expected",
    } as unknown);

    expect(res).toContain("tool execution not approved");
    expect(toolExecutor.execute).toHaveBeenCalledTimes(0);
    expect(usedTools.has("tool.exec")).toBe(false);
  });

  it("trims secret handle fields when resolving resumed tool args", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const secretProvider = {
      resolve: vi.fn(async (handle: { scope: string; created_at: string }) =>
        handle.scope === "SCOPE" && handle.created_at === "2026-02-23T00:00:00.000Z"
          ? JSON.stringify({ command: "echo from-secret" })
          : undefined,
      ),
    };

    const policyService = {
      isEnabled: () => false,
      isObserveOnly: () => false,
      evaluateToolCall: vi.fn(),
    };

    const toolSetBuilder = createToolSetBuilder({
      home: homeDir,
      container,
      policyService,
      secretProvider,
    });

    const approval = await container.approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: "plan-1:step:0:tool_call:tc-secret",
      kind: "workflow_step",
      prompt: "Resume tool.exec",
      context: {
        source: "agent-tool-execution",
        tool_id: "tool.exec",
        tool_call_id: "tc-secret",
        ai_sdk: {
          tool_args_handle: {
            handle_id: "h1",
            provider: "db",
            scope: "  SCOPE  ",
            created_at: " 2026-02-23T00:00:00.000Z ",
          },
        },
      },
    });

    const toolDesc = {
      id: "tool.exec",
      description: "Execute shell commands on the local machine.",
      risk: "high" as const,
      requires_confirmation: false,
      keywords: [],
      inputSchema: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
        additionalProperties: false,
      },
    };

    const toolExecutor = {
      execute: vi.fn(async () => ({
        tool_call_id: "tc-secret",
        output: "ok",
        error: undefined,
        provenance: undefined,
      })),
    };

    const usedTools = new Set<string>();
    const toolSet = toolSetBuilder.buildToolSet(
      [toolDesc],
      toolExecutor,
      usedTools,
      {
        planId: "plan-1",
        sessionId: "session-1",
        channel: "test",
        threadId: "thread-1",
        execution: {
          runId: "run-1",
          stepIndex: 0,
          stepId: "step-1",
          stepApprovalId: approval.approval_id,
        },
      },
      makeContextReport(),
    );

    await toolSet["tool.exec"]!.execute({ command: "echo hi" }, {
      toolCallId: "tc-secret",
    } as unknown);

    expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
    expect(toolExecutor.execute.mock.calls[0]?.[2]).toEqual({ command: "echo from-secret" });
  });
});
