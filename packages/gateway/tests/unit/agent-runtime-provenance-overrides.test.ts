import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import {
  makeContextReport,
  createToolSetBuilder,
  teardownTestEnv,
  DEFAULT_WORKSPACE_ID,
  migrationsDir,
} from "./agent-runtime.test-helpers.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContainer } from "../../src/container.js";
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

describe("AgentRuntime - provenance and policy overrides", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("does not let concurrent tool calls change input provenance mid-flight for policy evaluation", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    let resolveList:
      | ((
          value: Array<{
            handle_id: string;
            provider: string;
            scope: string;
            created_at: string;
          }>,
        ) => void)
      | undefined;
    const listPromise = new Promise<
      Array<{ handle_id: string; provider: string; scope: string; created_at: string }>
    >((resolve) => {
      resolveList = resolve;
    });

    const secretProvider = {
      resolve: vi.fn(async () => "secret-value"),
      store: vi.fn(async () => ({
        handle_id: "h1",
        provider: "db",
        scope: "SCOPE",
        created_at: new Date().toISOString(),
      })),
      revoke: vi.fn(async () => true),
      list: vi.fn(async () => await listPromise),
    };

    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateToolCall: vi.fn(async () => ({ decision: "allow" as const })),
    };

    const toolSetBuilder = createToolSetBuilder({
      home: homeDir,
      container,
      policyService,
      secretProvider,
    });

    const toolDescs = [
      {
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
      },
      {
        id: "tool.http.fetch",
        description: "Make outbound HTTP requests.",
        risk: "medium" as const,
        requires_confirmation: true,
        keywords: [],
        inputSchema: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
          additionalProperties: false,
        },
      },
    ];

    const toolExecutor = {
      execute: vi.fn(async (toolId: string) => {
        if (toolId === "tool.http.fetch") {
          return {
            tool_call_id: "tc-test-fetch",
            output: "ok",
            error: undefined,
            provenance: { content: "ok", source: "web", trusted: false },
          };
        }
        return {
          tool_call_id: "tc-test-exec",
          output: "ok",
          error: undefined,
          provenance: undefined,
        };
      }),
    };

    const usedTools = new Set<string>();
    const toolSet = toolSetBuilder.buildToolSet(
      toolDescs,
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

    const execPromise = toolSet["tool.exec"]!.execute({ command: "secret:h1" });
    const fetchPromise = toolSet["tool.http.fetch"]!.execute({ url: "https://example.com" });

    await fetchPromise;
    resolveList?.([
      {
        handle_id: "h1",
        provider: "db",
        scope: "SCOPE",
        created_at: new Date().toISOString(),
      },
    ]);
    await execPromise;

    const execCall = policyService.evaluateToolCall.mock.calls
      .map(
        (call) =>
          call[0] as { toolId?: string; inputProvenance?: { source: string; trusted: boolean } },
      )
      .find((call) => call.toolId === "tool.exec");
    expect(execCall?.inputProvenance).toEqual({ source: "user", trusted: true });
  });

  it("uses canonicalized fs match targets for policy evaluation and suggested overrides", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateToolCall: vi.fn(async () => ({ decision: "require_approval" as const })),
    };

    const toolSetBuilder = createToolSetBuilder({ home: homeDir, container, policyService });

    vi.mocked(awaitApprovalForToolExecution).mockClear();
    const approvalSpy = vi.mocked(awaitApprovalForToolExecution).mockResolvedValue({
      approved: true,
      status: "approved",
      approvalId: "approval-1",
    });

    const toolDesc = {
      id: "tool.fs.read",
      description: "Read files from workspace.",
      risk: "high" as const,
      requires_confirmation: false,
      keywords: [],
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
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

    const result = await toolSet["tool.fs.read"]!.execute({
      path: " ./docs//architecture/../policy-overrides.md ",
    });

    expect(result).toBe("ok");
    expect(policyService.evaluateToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolMatchTarget: "read:docs/policy-overrides.md",
      }),
    );
    expect(approvalSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ id: "tool.fs.read" }),
      expect.any(Object),
      expect.any(String),
      expect.any(Object),
      expect.any(Number),
      expect.objectContaining({
        workspace_id: DEFAULT_WORKSPACE_ID,
        suggested_overrides: [
          {
            tool_id: "tool.fs.read",
            pattern: "read:docs/policy-overrides.md",
            workspace_id: DEFAULT_WORKSPACE_ID,
          },
        ],
      }),
    );
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
    expect(usedTools.has("tool.fs.read")).toBe(true);
  });

  it("suggests a conservative prefix override for Desktop act node dispatch", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateToolCall: vi.fn(async () => ({ decision: "require_approval" as const })),
    };

    const toolSetBuilder = createToolSetBuilder({ home: homeDir, container, policyService });

    vi.mocked(awaitApprovalForToolExecution).mockClear();
    const approvalSpy = vi.mocked(awaitApprovalForToolExecution).mockResolvedValue({
      approved: true,
      status: "approved",
      approvalId: "approval-1",
    });

    const toolDesc = {
      id: "tool.node.dispatch",
      description: "Dispatch tasks to connected node capabilities.",
      risk: "high" as const,
      requires_confirmation: true,
      keywords: [],
      inputSchema: {
        type: "object",
        properties: {
          capability: { type: "string" },
          action: { type: "string" },
          args: { type: "object", additionalProperties: {} },
          timeout_ms: { type: "number" },
        },
        required: ["capability", "action"],
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
    ) as unknown as Record<string, { execute: (args: unknown) => Promise<string> }>;

    const result = await toolSet["tool.node.dispatch"]!.execute({
      capability: "tyrum.desktop",
      action: "Desktop",
      args: {
        op: "act",
        target: { kind: "a11y", role: "button", name: "Submit", states: [] },
        action: { kind: "click" },
      },
    });

    expect(result).toBe("ok");
    expect(policyService.evaluateToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolMatchTarget: "capability:tyrum.desktop;action:Desktop;op:act;act:ui",
      }),
    );

    expect(approvalSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ id: "tool.node.dispatch" }),
      expect.any(Object),
      expect.any(String),
      expect.any(Object),
      expect.any(Number),
      expect.objectContaining({
        workspace_id: DEFAULT_WORKSPACE_ID,
        suggested_overrides: [
          {
            tool_id: "tool.node.dispatch",
            pattern: "capability:tyrum.desktop;action:Desktop;op:act;act:ui",
            workspace_id: DEFAULT_WORKSPACE_ID,
          },
          {
            tool_id: "tool.node.dispatch",
            pattern: "capability:tyrum.desktop;action:Desktop;op:act*",
            workspace_id: DEFAULT_WORKSPACE_ID,
          },
        ],
      }),
    );
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
    expect(usedTools.has("tool.node.dispatch")).toBe(true);
  });

  it("omits suggested overrides when the match target contains wildcard characters", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateToolCall: vi.fn(async () => ({ decision: "require_approval" as const })),
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
      description: "Execute shell commands.",
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

    const result = await toolSet["tool.exec"]!.execute({ command: "echo *" });
    expect(result).toBe("ok");

    expect(policyService.evaluateToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolMatchTarget: "echo *",
      }),
    );

    const policyContext = approvalSpy.mock.calls[0]?.[6] as
      | { suggested_overrides?: unknown }
      | undefined;
    expect(policyContext?.suggested_overrides).toBeUndefined();
  });
});
