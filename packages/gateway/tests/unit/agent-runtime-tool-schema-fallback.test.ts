import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import { McpManager } from "../../src/modules/agent/mcp-manager.js";
import { WORKBOARD_TOOL_REGISTRY } from "../../src/modules/agent/tool-catalog-workboard.js";
import { buildBuiltinMemoryServerSpec } from "../../src/modules/memory/builtin-mcp.js";
import {
  createToolSetBuilder,
  makeContextReport,
  setupTestEnv,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";

describe("ToolSetBuilder schema fallback", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("builds and executes tools that omit inputSchema", async () => {
    ({ homeDir, container } = await setupTestEnv());

    const toolSetBuilder = createToolSetBuilder({
      home: homeDir,
      container,
      policyService: {
        isEnabled: () => false,
        isObserveOnly: () => false,
      },
    });
    const toolExecutor = {
      execute: vi.fn(async () => ({
        tool_call_id: "tc-plugin-1",
        output: "ok",
      })),
    };

    const toolSet = toolSetBuilder.buildToolSet(
      [
        {
          id: "plugin.echo.say",
          description: "Echo text back to the caller.",
          risk: "low",
          requires_confirmation: false,
          keywords: ["echo"],
        },
      ],
      toolExecutor as never,
      new Set<string>(),
      {
        planId: "plan-1",
        sessionId: "session-1",
        channel: "test",
        threadId: "thread-1",
      },
      makeContextReport() as never,
    );

    const result = await toolSet["plugin_echo_say"]?.execute({ text: "hello" });

    expect(result).toBe("ok");
    expect(toolExecutor.execute).toHaveBeenCalledWith(
      "plugin.echo.say",
      expect.any(String),
      { text: "hello" },
      expect.objectContaining({
        session_id: "session-1",
        channel: "test",
        thread_id: "thread-1",
      }),
    );
  });

  it("normalizes built-in memory MCP schemas before registering model tools", async () => {
    ({ homeDir, container } = await setupTestEnv());

    const toolSetBuilder = createToolSetBuilder({
      home: homeDir,
      container,
      policyService: {
        isEnabled: () => false,
        isObserveOnly: () => false,
      },
    });
    const mcpManager = new McpManager();
    const descriptors = await mcpManager.listServerToolDescriptors(buildBuiltinMemoryServerSpec());

    try {
      const toolSet = toolSetBuilder.buildToolSet(
        descriptors,
        {
          execute: vi.fn(async () => ({
            tool_call_id: "tc-memory-write",
            output: "ok",
          })),
        } as never,
        new Set<string>(),
        {
          planId: "plan-memory",
          sessionId: "session-memory",
          channel: "test",
          threadId: "thread-memory",
        },
        makeContextReport() as never,
      );

      const modelTool = toolSet["mcp_memory_write"] as {
        inputSchema?: { jsonSchema?: Record<string, unknown> };
      };

      expect(modelTool.inputSchema?.jsonSchema).toMatchObject({
        type: "object",
        required: ["kind"],
      });
      expect(modelTool.inputSchema?.jsonSchema).not.toHaveProperty("oneOf");
      expect(modelTool.inputSchema?.jsonSchema).not.toHaveProperty("anyOf");
      expect(modelTool.inputSchema?.jsonSchema).not.toHaveProperty("allOf");
      expect(modelTool.inputSchema?.jsonSchema).not.toHaveProperty("enum");
      expect(modelTool.inputSchema?.jsonSchema).not.toHaveProperty("not");
    } finally {
      await mcpManager.shutdown();
    }
  });

  it("registers workboard artifact tools with explicit model-safe properties", async () => {
    ({ homeDir, container } = await setupTestEnv());

    const toolSetBuilder = createToolSetBuilder({
      home: homeDir,
      container,
      policyService: {
        isEnabled: () => false,
        isObserveOnly: () => false,
      },
    });
    const descriptor = WORKBOARD_TOOL_REGISTRY.find((tool) => tool.id === "workboard.artifact.get");
    expect(descriptor).toBeDefined();
    if (!descriptor) {
      throw new Error("missing workboard.artifact.get descriptor");
    }

    const toolSet = toolSetBuilder.buildToolSet(
      [descriptor],
      {
        execute: vi.fn(async () => ({
          tool_call_id: "tc-workboard-artifact-get",
          output: "ok",
        })),
      } as never,
      new Set<string>(),
      {
        planId: "plan-workboard",
        sessionId: "session-workboard",
        channel: "test",
        threadId: "thread-workboard",
      },
      makeContextReport() as never,
    );

    const modelTool = toolSet["workboard_artifact_get"] as {
      inputSchema?: { jsonSchema?: Record<string, unknown> };
    };

    expect(modelTool.inputSchema?.jsonSchema).toMatchObject({
      type: "object",
      properties: {
        artifact_id: { type: "string" },
      },
      required: ["artifact_id"],
      additionalProperties: false,
    });
  });
});
