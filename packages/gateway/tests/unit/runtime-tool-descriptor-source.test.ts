import { AgentConfig } from "@tyrum/contracts";
import { describe, expect, it, vi } from "vitest";
import { getExecutionProfile } from "../../src/modules/agent/execution-profiles.js";
import { listAvailableRuntimeTools } from "../../src/modules/agent/runtime/agent-runtime-status.js";
import { ToolSetBuilder } from "../../src/modules/agent/runtime/tool-set-builder.js";
import { resolveToolExecutionRuntime } from "../../src/modules/agent/runtime/turn-preparation-runtime.js";
import { SECRET_CLIPBOARD_TOOL_ID } from "../../src/modules/agent/tool-secret-definitions.js";

describe("runtime tool descriptor source", () => {
  it("keeps turn preparation and runtime status on the same local-mode tool universe", async () => {
    vi.spyOn(ToolSetBuilder.prototype, "resolvePolicyGatedPluginToolExposure").mockImplementation(
      ({ allowlist, pluginTools }) => ({
        allowlist: [...allowlist],
        pluginTools: [...pluginTools],
      }),
    );

    const mcpTool = {
      id: "mcp.calendar.events_list",
      description: "List calendar events.",
      effect: "read_only" as const,
      keywords: ["calendar", "events"],
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    };
    const pluginTool = {
      id: " plugin.echo.readonly ",
      description: "Read plugin state.",
      effect: "read_only" as const,
      keywords: ["plugin", "echo"],
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    };
    const mcpManager = {
      listToolDescriptors: vi.fn().mockResolvedValue([mcpTool]),
    };
    const plugins = {
      getToolDescriptors: vi.fn().mockReturnValue([pluginTool]),
    };
    const loaded = {
      config: AgentConfig.parse({
        model: { model: "openai/gpt-4.1" },
        tools: {
          default_mode: "deny",
          allow: [
            "read",
            "mcp.calendar.events_list",
            "plugin.echo.readonly",
            SECRET_CLIPBOARD_TOOL_ID,
          ],
          deny: [],
        },
        secret_refs: [
          {
            secret_ref_id: "secret-ref-1",
            secret_alias: "calendar-token",
            allowed_tool_ids: [SECRET_CLIPBOARD_TOOL_ID],
          },
        ],
      }),
      identity: {} as never,
      skills: [],
      mcpServers: [{ id: "calendar" }] as never,
    };
    const opts = {
      container: {
        deploymentConfig: {},
        db: {} as never,
        approvalDal: {} as never,
        logger: { warn: vi.fn() },
        redactionEngine: {} as never,
      },
    } as never;

    const turnRuntime = await resolveToolExecutionRuntime(
      {
        tenantId: "tenant-1",
        home: "/workspace",
        contextStore: {} as never,
        agentId: "agent-1",
        workspaceId: "workspace-1",
        mcpManager: mcpManager as never,
        plugins: plugins as never,
        policyService: {} as never,
        approvalNotifier: {} as never,
        approvalWaitMs: 1_000,
        approvalPollMs: 100,
        conversationDal: {} as never,
        secretProvider: undefined,
        opts,
      },
      loaded,
      {
        tenant_id: "tenant-1",
        agent_id: "agent-1",
        workspace_id: "workspace-1",
      } as never,
      {
        message: "calendar plugin secret clipboard",
      } as never,
      {
        id: "interaction",
        profile: getExecutionProfile("interaction"),
        source: "interaction_default",
      },
    );
    const runtimeStatusTools = await listAvailableRuntimeTools({
      opts,
      mcpManager: mcpManager as never,
      loaded,
      plugins: plugins as never,
    });

    expect(turnRuntime.availableTools.map((tool) => tool.id)).toEqual(
      runtimeStatusTools.map((tool) => tool.id),
    );
    expect(turnRuntime.availableTools.map((tool) => tool.id)).toContain(SECRET_CLIPBOARD_TOOL_ID);
    expect(turnRuntime.availableTools.map((tool) => tool.id)).toContain("plugin.echo.readonly");
    expect(turnRuntime.availableTools.map((tool) => tool.id)).toContain("mcp.calendar.events_list");

    const pluginDescriptor = turnRuntime.availableTools.find(
      (tool) => tool.id === "plugin.echo.readonly",
    );
    const mcpDescriptor = turnRuntime.availableTools.find(
      (tool) => tool.id === "mcp.calendar.events_list",
    );
    expect(pluginDescriptor?.taxonomy).toMatchObject({
      canonicalId: "plugin.echo.readonly",
      lifecycle: "canonical",
      visibility: "public",
      group: "extension",
      tier: "advanced",
    });
    expect(mcpDescriptor?.taxonomy).toMatchObject({
      canonicalId: "mcp.calendar.events_list",
      lifecycle: "canonical",
      visibility: "public",
      group: "extension",
      tier: "advanced",
    });
  });

  it("preserves deprecated memory-alias taxonomy metadata through runtime descriptor aggregation", async () => {
    const mcpManager = {
      listToolDescriptors: vi.fn().mockResolvedValue([
        {
          id: "mcp.memory.search",
          description: "Search memory.",
          effect: "read_only" as const,
          keywords: ["memory", "search"],
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ]),
    };
    const loaded = {
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
    };
    const opts = {
      container: {
        deploymentConfig: {},
        db: {} as never,
        approvalDal: {} as never,
        logger: { warn: vi.fn() },
        redactionEngine: {} as never,
      },
    } as never;

    const runtimeStatusTools = await listAvailableRuntimeTools({
      opts,
      mcpManager: mcpManager as never,
      loaded,
      plugins: undefined,
    });

    const memorySearch = runtimeStatusTools.find((tool) => tool.id === "mcp.memory.search");
    expect(memorySearch?.taxonomy).toMatchObject({
      canonicalId: "memory.search",
      lifecycle: "deprecated",
      visibility: "public",
      family: "memory",
      group: "memory",
      tier: "default",
    });
  });
});
