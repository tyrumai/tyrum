import { describe, expect, it, vi } from "vitest";
import { ToolSetBuilder } from "../../src/modules/agent/runtime/tool-set-builder.js";

function makeContextReport(): Record<string, unknown> {
  return {
    context_report_id: "123e4567-e89b-12d3-a456-426614174000",
    generated_at: "2026-02-23T00:00:00.000Z",
    session_id: "session-1",
    channel: "test",
    thread_id: "thread-1",
    agent_id: "agent-1",
    workspace_id: "workspace-1",
    system_prompt: { chars: 0, sections: [] },
    user_parts: [],
    selected_tools: [],
    tool_schema_top: [],
    tool_schema_total_chars: 0,
    enabled_skills: [],
    mcp_servers: [],
    memory: { keyword_hits: 0, semantic_hits: 0 },
    tool_calls: [],
    injected_files: [],
  };
}

describe("ToolSetBuilder shared mode", () => {
  it("does not pass a gateway home path into plugin tools", async () => {
    const plugins = {
      executeTool: vi.fn(async () => ({ output: "hi" })),
    };
    const toolSetBuilder = new ToolSetBuilder({
      home: "/tmp/tyrum-home",
      stateMode: "shared",
      tenantId: "tenant-1",
      agentId: "agent-1",
      workspaceId: "workspace-1",
      policyService: {
        isEnabled: () => false,
        isObserveOnly: () => false,
        evaluateToolCall: vi.fn(),
      } as never,
      approvalDal: {} as never,
      approvalWaitMs: 120_000,
      approvalPollMs: 500,
      logger: { info() {} },
      plugins: plugins as never,
    });
    const toolSet = toolSetBuilder.buildToolSet(
      [
        {
          id: "plugin.echo.echo",
          description: "Echo back a string.",
          risk: "low",
          requires_confirmation: false,
          keywords: [],
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
      ],
      { execute: vi.fn() } as never,
      new Set<string>(),
      {
        planId: "plan-1",
        sessionId: "session-1",
        channel: "test",
        threadId: "thread-1",
      },
      makeContextReport() as never,
    );

    await toolSet["plugin.echo.echo"]!.execute({});

    expect(plugins.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        home: "",
      }),
    );
  });
});
