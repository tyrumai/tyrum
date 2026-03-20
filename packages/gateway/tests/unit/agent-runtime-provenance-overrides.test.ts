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
        id: "bash",
        description: "Execute shell commands on the local machine.",
        effect: "state_changing" as const,
        keywords: [],
        inputSchema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
          additionalProperties: false,
        },
      },
      {
        id: "webfetch",
        description: "Make outbound HTTP requests.",
        effect: "state_changing" as const,
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
        if (toolId === "webfetch") {
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

    const execPromise = toolSet["bash"]!.execute({ command: "secret:h1" });
    const fetchPromise = toolSet["webfetch"]!.execute({ url: "https://example.com" });

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
      .find((call) => call.toolId === "bash");
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
      id: "read",
      description: "Read files from workspace.",
      effect: "state_changing" as const,
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

    const result = await toolSet["read"]!.execute({
      path: " ./docs//architecture/gateway/./policy-overrides.md ",
    });

    expect(result).toBe("ok");
    expect(policyService.evaluateToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolMatchTarget: "read:docs/architecture/gateway/policy-overrides.md",
      }),
    );
    expect(approvalSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ id: "read" }),
      expect.any(Object),
      expect.any(String),
      expect.any(Object),
      expect.any(Number),
      expect.objectContaining({
        workspace_id: DEFAULT_WORKSPACE_ID,
        suggested_overrides: [
          {
            tool_id: "read",
            pattern: "read:docs/architecture/gateway/policy-overrides.md",
            workspace_id: DEFAULT_WORKSPACE_ID,
          },
        ],
      }),
      expect.any(Function),
    );
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
    expect(usedTools.has("read")).toBe(true);
  });

  it("uses the resolved current agent key for location place policy targets when agent_key is omitted", async () => {
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
      approvalId: "approval-location-1",
    });

    const toolDesc = {
      id: "tool.location.place.list",
      description: "List saved places for the current or specified agent.",
      effect: "read_only" as const,
      keywords: [],
      inputSchema: {
        type: "object",
        properties: {
          agent_key: { type: "string" },
        },
        additionalProperties: false,
      },
    };

    const toolExecutor = {
      execute: vi.fn(async () => ({
        tool_call_id: "tc-test-location",
        output: '{"places":[]}',
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
        planId: "plan-location-1",
        sessionId: "session-location-1",
        channel: "test",
        threadId: "thread-location-1",
      },
      makeContextReport(),
    );

    const result = await toolSet["tool.location.place.list"]!.execute({});

    expect(result).toBe('{"places":[]}');
    expect(policyService.evaluateToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolMatchTarget: "agent_key:default",
      }),
    );
    expect(approvalSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ id: "tool.location.place.list" }),
      expect.any(Object),
      expect.any(String),
      expect.any(Object),
      expect.any(Number),
      expect.objectContaining({
        workspace_id: DEFAULT_WORKSPACE_ID,
        suggested_overrides: [
          {
            tool_id: "tool.location.place.list",
            pattern: "agent_key:default",
            workspace_id: DEFAULT_WORKSPACE_ID,
          },
        ],
      }),
      expect.any(Function),
    );
  });

  it("suggests a dedicated override for Desktop act tool approvals", async () => {
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
      id: "tool.desktop.act",
      description: "Perform a desktop UI action.",
      effect: "state_changing" as const,
      keywords: [],
      inputSchema: {
        type: "object",
        properties: {
          node_id: { type: "string" },
          target: { type: "object", additionalProperties: true },
          action: { type: "object", additionalProperties: true },
          timeout_ms: { type: "number" },
        },
        required: ["target", "action"],
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

    const result = await toolSet["tool.desktop.act"]!.execute({
      node_id: "node-1",
      target: { kind: "a11y", role: "button", name: "Submit", states: [] },
      action: { kind: "click" },
    });

    expect(result).toBe("ok");
    expect(policyService.evaluateToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolMatchTarget: "tool.desktop.act",
      }),
    );

    expect(approvalSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ id: "tool.desktop.act" }),
      expect.any(Object),
      expect.any(String),
      expect.any(Object),
      expect.any(Number),
      expect.objectContaining({
        workspace_id: DEFAULT_WORKSPACE_ID,
        suggested_overrides: [
          {
            tool_id: "tool.desktop.act",
            pattern: "tool.desktop.act",
            workspace_id: DEFAULT_WORKSPACE_ID,
          },
        ],
      }),
      expect.any(Function),
    );
    expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
    expect(usedTools.has("tool.desktop.act")).toBe(true);
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
      id: "bash",
      description: "Execute shell commands.",
      effect: "state_changing" as const,
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

    const result = await toolSet["bash"]!.execute({ command: "echo *" });
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
