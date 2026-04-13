import { AgentConfig } from "@tyrum/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFile: execFileMock,
  };
});

import { getExecutionProfile } from "../../src/modules/agent/execution-profiles.js";
import { ToolSetBuilder } from "../../src/modules/agent/runtime/tool-set-builder.js";
import {
  buildToolSetBuilderDeps,
  buildRuntimePrompt,
  canPatternMatchMcpToolId,
  resetGitRootCacheForTests,
  resolveGitRoot,
  resolveToolExecutionRuntime,
} from "../../src/modules/agent/runtime/turn-preparation-runtime.js";

describe("turn preparation runtime helpers", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    resetGitRootCacheForTests();
    vi.restoreAllMocks();
  });

  it("caches git root lookups per home directory", async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as
        | ((error: Error | null, stdout: string, stderr: string) => void)
        | undefined;
      queueMicrotask(() => callback?.(null, "/repo\n", ""));
      return {} as never;
    });

    await expect(resolveGitRoot("/workspace")).resolves.toBe("/repo");
    await expect(resolveGitRoot("/workspace")).resolves.toBe("/repo");

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["-C", "/workspace", "rev-parse", "--show-toplevel"],
      expect.objectContaining({ encoding: "utf-8" }),
      expect.any(Function),
    );
  });

  it("refreshes cached git roots after the ttl expires", async () => {
    execFileMock.mockImplementationOnce((...args: unknown[]) => {
      const callback = args.at(-1) as
        | ((error: Error | null, stdout: string, stderr: string) => void)
        | undefined;
      queueMicrotask(() => callback?.(null, "/repo-1\n", ""));
      return {} as never;
    });
    execFileMock.mockImplementationOnce((...args: unknown[]) => {
      const callback = args.at(-1) as
        | ((error: Error | null, stdout: string, stderr: string) => void)
        | undefined;
      queueMicrotask(() => callback?.(null, "/repo-2\n", ""));
      return {} as never;
    });

    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(0);
    await expect(resolveGitRoot("/workspace")).resolves.toBe("/repo-1");

    now.mockReturnValue(30_000);
    await expect(resolveGitRoot("/workspace")).resolves.toBe("/repo-1");

    now.mockReturnValue(61_000);
    await expect(resolveGitRoot("/workspace")).resolves.toBe("/repo-2");

    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  it("includes the resolved git root in the runtime prompt", async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1) as
        | ((error: Error | null, stdout: string, stderr: string) => void)
        | undefined;
      queueMicrotask(() => callback?.(null, "/repo-root\n", ""));
      return {} as never;
    });

    const prompt = await buildRuntimePrompt({
      nowIso: "2026-03-09T00:00:00.000Z",
      agentId: "agent-1",
      workspaceId: "workspace-1",
      conversationId: "conversation-1",
      channel: "test",
      threadId: "thread-1",
      home: "/workspace-prompt",
      stateMode: "local",
      model: "model-1",
    });

    expect(prompt).toContain("Git repo root: /repo-root");
    expect(prompt).not.toContain("Approval workflow available:");
  });

  it("accepts wildcard allow-list patterns that can match an MCP tool id", () => {
    expect(canPatternMatchMcpToolId("*.weather.*")).toBe(true);
    expect(canPatternMatchMcpToolId("m?p.weather.*")).toBe(true);
    expect(canPatternMatchMcpToolId("mcp*")).toBe(true);
    expect(canPatternMatchMcpToolId("calendar.*")).toBe(false);
  });

  it("builds shared ToolSetBuilder deps for both normal and guardian review turns", () => {
    const deps = buildToolSetBuilderDeps(
      {
        home: "/workspace",
        conversationDal: {} as never,
        policyService: {} as never,
        approvalWaitMs: 1_000,
        approvalPollMs: 100,
        secretProvider: {} as never,
        plugins: {} as never,
        opts: {
          container: {
            deploymentConfig: {},
            db: {} as never,
            approvalDal: {} as never,
            logger: {} as never,
            redactionEngine: { redactText: vi.fn() },
          },
          protocolDeps: { connectionManager: {} } as never,
        } as never,
      },
      {
        tenant_id: "tenant-1",
        agent_id: "agent-1",
        workspace_id: "workspace-1",
      },
    );

    expect(deps).toMatchObject({
      home: "/workspace",
      tenantId: "tenant-1",
      agentId: "agent-1",
      workspaceId: "workspace-1",
      approvalWaitMs: 1_000,
      approvalPollMs: 100,
    });
    expect(deps.redactionEngine).toBeDefined();
    expect(deps.protocolDeps).toBeDefined();
  });

  it("keeps object-root top-level oneOf schemas after provider-safe normalization", async () => {
    vi.spyOn(ToolSetBuilder.prototype, "resolvePolicyGatedPluginToolExposure").mockImplementation(
      ({ allowlist, pluginTools }) => ({
        allowlist: [...allowlist],
        pluginTools: [...pluginTools],
      }),
    );

    const logger = { warn: vi.fn() };
    const normalizableTool = {
      id: "mcp.memory.write",
      description: "Persist durable memory.",
      effect: "read_only" as const,
      keywords: ["memory", "write"],
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["fact", "note"] },
          key: { type: "string" },
          value: {},
          body_md: { type: "string" },
        },
        required: ["kind"],
        additionalProperties: false,
        oneOf: [
          {
            properties: { kind: { type: "string", enum: ["fact"] } },
            required: ["kind", "key", "value"],
          },
          {
            properties: { kind: { type: "string", enum: ["note"] } },
            required: ["kind", "body_md"],
          },
        ],
      },
    };

    const result = await resolveToolExecutionRuntime(
      {
        tenantId: "tenant-1",
        home: "/workspace",
        contextStore: {} as never,
        agentId: "agent-1",
        workspaceId: "workspace-1",
        mcpManager: {
          listToolDescriptors: vi.fn().mockResolvedValue([normalizableTool]),
        } as never,
        plugins: undefined,
        policyService: {} as never,
        approvalNotifier: {} as never,
        approvalWaitMs: 1_000,
        approvalPollMs: 100,
        conversationDal: {} as never,
        secretProvider: undefined,
        opts: {
          container: {
            deploymentConfig: {},
            db: {} as never,
            approvalDal: {} as never,
            logger,
            redactionEngine: {} as never,
          },
        } as never,
      },
      {
        config: AgentConfig.parse({
          model: { model: "openai/gpt-4.1" },
        }),
        identity: {} as never,
        skills: [],
        mcpServers: [],
      },
      {
        tenant_id: "tenant-1",
        agent_id: "agent-1",
        workspace_id: "workspace-1",
      } as never,
      {
        message: "store this in memory",
      } as never,
      {
        id: "interaction",
        profile: getExecutionProfile("interaction"),
        source: "interaction_default",
      },
    );

    const availableTool = result.availableTools.find((tool) => tool.id === "mcp.memory.write");
    const filteredTool = result.filteredTools.find((tool) => tool.id === "mcp.memory.write");

    expect(availableTool?.inputSchema).toMatchObject({
      type: "object",
      required: ["kind"],
    });
    expect(filteredTool?.inputSchema).toMatchObject({
      type: "object",
      required: ["kind"],
    });
    expect(filteredTool?.inputSchema).not.toHaveProperty("oneOf");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("keeps legacy memory tool descriptors available under canonical execution-profile allowlists", async () => {
    vi.spyOn(ToolSetBuilder.prototype, "resolvePolicyGatedPluginToolExposure").mockImplementation(
      ({ allowlist, pluginTools }) => ({
        allowlist: [...allowlist],
        pluginTools: [...pluginTools],
      }),
    );

    const legacyMemorySearchTool = {
      id: "mcp.memory.search",
      description: "Search durable memory.",
      effect: "read_only" as const,
      keywords: ["memory", "search"],
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    };

    const result = await resolveToolExecutionRuntime(
      {
        tenantId: "tenant-1",
        home: "/workspace",
        contextStore: {} as never,
        agentId: "agent-1",
        workspaceId: "workspace-1",
        mcpManager: {
          listToolDescriptors: vi.fn().mockResolvedValue([legacyMemorySearchTool]),
        } as never,
        plugins: undefined,
        policyService: {} as never,
        approvalNotifier: {} as never,
        approvalWaitMs: 1_000,
        approvalPollMs: 100,
        conversationDal: {} as never,
        secretProvider: undefined,
        opts: {
          container: {
            deploymentConfig: {},
            db: {} as never,
            approvalDal: {} as never,
            logger: { warn: vi.fn() },
            redactionEngine: {} as never,
          },
        } as never,
      },
      {
        config: AgentConfig.parse({
          model: { model: "openai/gpt-4.1" },
          tools: {
            default_mode: "allow",
            allow: [],
            deny: [],
          },
        }),
        identity: {} as never,
        skills: [],
        mcpServers: [{ id: "memory" }] as never,
      },
      {
        tenant_id: "tenant-1",
        agent_id: "agent-1",
        workspace_id: "workspace-1",
      } as never,
      {
        message: "search memory for the note",
      } as never,
      {
        id: "explorer_ro",
        profile: getExecutionProfile("explorer_ro"),
        source: "explorer_ro_default",
      },
    );

    expect(result.availableTools.map((tool) => tool.id)).toContain("mcp.memory.search");
    expect(result.filteredTools.map((tool) => tool.id)).toContain("mcp.memory.search");
  });

  it("warns once per invalid tool schema even when the tool is reused for pre-turn lookup", async () => {
    vi.spyOn(ToolSetBuilder.prototype, "resolvePolicyGatedPluginToolExposure").mockImplementation(
      ({ allowlist, pluginTools }) => ({
        allowlist: [...allowlist],
        pluginTools: [...pluginTools],
      }),
    );

    const logger = { warn: vi.fn() };
    const invalidTool = {
      id: "mcp.invalid.schema",
      description: "Invalid MCP tool",
      effect: "read_only" as const,
      keywords: ["invalid"],
      inputSchema: { type: "string" },
    };

    const result = await resolveToolExecutionRuntime(
      {
        tenantId: "tenant-1",
        home: "/workspace",
        contextStore: {} as never,
        agentId: "agent-1",
        workspaceId: "workspace-1",
        mcpManager: {
          listToolDescriptors: vi.fn().mockResolvedValue([invalidTool]),
        } as never,
        plugins: undefined,
        policyService: {} as never,
        approvalNotifier: {} as never,
        approvalWaitMs: 1_000,
        approvalPollMs: 100,
        conversationDal: {} as never,
        secretProvider: undefined,
        opts: {
          container: {
            deploymentConfig: {},
            db: {} as never,
            approvalDal: {} as never,
            logger,
            redactionEngine: {} as never,
          },
        } as never,
      },
      {
        config: AgentConfig.parse({
          model: { model: "openai/gpt-4.1" },
        }),
        identity: {} as never,
        skills: [],
        mcpServers: [],
      },
      {
        tenant_id: "tenant-1",
        agent_id: "agent-1",
        workspace_id: "workspace-1",
      } as never,
      {
        message: "check the invalid tool",
      } as never,
      {
        id: "interaction",
        profile: getExecutionProfile("interaction"),
        source: "interaction_default",
      },
    );

    expect(result.availableTools.map((tool) => tool.id)).not.toContain("mcp.invalid.schema");
    expect(result.filteredTools.map((tool) => tool.id)).not.toContain("mcp.invalid.schema");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("agent.tool_schema_invalid", {
      tool_id: "mcp.invalid.schema",
      error:
        'mcp.invalid.schema: input schema must have a top-level JSON Schema object root (`type: "object"`)',
    });
  });

  it("normalizes plugin tool ids before policy gating", async () => {
    const policySpy = vi
      .spyOn(ToolSetBuilder.prototype, "resolvePolicyGatedPluginToolExposure")
      .mockImplementation(({ allowlist, pluginTools }) => ({
        allowlist: [...allowlist],
        pluginTools: [...pluginTools],
      }));

    const logger = { warn: vi.fn() };
    await resolveToolExecutionRuntime(
      {
        tenantId: "tenant-1",
        home: "/workspace",
        contextStore: {} as never,
        agentId: "agent-1",
        workspaceId: "workspace-1",
        mcpManager: {
          listToolDescriptors: vi.fn().mockResolvedValue([]),
        } as never,
        plugins: {
          getToolDescriptors: vi.fn().mockReturnValue([
            {
              id: " plugin.echo.readonly ",
              description: "Read plugin state.",
              effect: "read_only" as const,
              keywords: ["read"],
              inputSchema: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
            },
            {
              id: "   ",
              description: "Ignored blank id.",
              effect: "read_only" as const,
              keywords: ["blank"],
              inputSchema: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
            },
          ]),
        } as never,
        policyService: {} as never,
        approvalNotifier: {} as never,
        approvalWaitMs: 1_000,
        approvalPollMs: 100,
        conversationDal: {} as never,
        secretProvider: undefined,
        opts: {
          container: {
            deploymentConfig: {},
            db: {} as never,
            approvalDal: {} as never,
            logger,
            redactionEngine: {} as never,
          },
        } as never,
      },
      {
        config: AgentConfig.parse({
          model: { model: "openai/gpt-4.1" },
        }),
        identity: {} as never,
        skills: [],
        mcpServers: [],
      },
      {
        tenant_id: "tenant-1",
        agent_id: "agent-1",
        workspace_id: "workspace-1",
      } as never,
      {
        message: "use the plugin tool",
      } as never,
      {
        id: "interaction",
        profile: getExecutionProfile("interaction"),
        source: "interaction_default",
      },
    );

    const policyInput = policySpy.mock.calls[0]?.[0];
    expect(policyInput?.pluginTools.map((tool) => tool.id)).toEqual(["plugin.echo.readonly"]);
    expect(policyInput?.allowlist).toContain("plugin.echo.readonly");
  });
});
