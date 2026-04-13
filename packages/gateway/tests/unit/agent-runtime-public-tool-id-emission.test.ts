import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContextReport } from "../../src/modules/agent/runtime/types.js";
import type { ContextReportInput } from "../../src/modules/agent/runtime/turn-context-report.js";
import { buildContextReport } from "../../src/modules/agent/runtime/turn-context-report.js";
import {
  recordToolResultContext,
  syncToolLifecycle,
} from "../../src/modules/agent/runtime/tool-set-builder-lifecycle.js";
import { enqueueWsBroadcastMessage } from "../../src/ws/outbox.js";

vi.mock("../../src/ws/outbox.js", () => ({
  enqueueWsBroadcastMessage: vi.fn(),
}));

const enqueueWsBroadcastMessageMock = vi.mocked(enqueueWsBroadcastMessage);

function createContextReportInput(): ContextReportInput {
  return {
    conversation: {
      conversation_id: "conversation-1",
      agent_id: "default",
      workspace_id: "default",
    } as ContextReportInput["conversation"],
    resolved: {
      channel: "ui",
      thread_id: "thread-1",
      message: "remember this note",
    } as ContextReportInput["resolved"],
    ctx: {
      skills: [],
      mcpServers: [],
    } as ContextReportInput["ctx"],
    executionProfile: {
      id: "interaction",
      source: "interaction_default",
    } as ContextReportInput["executionProfile"],
    filteredTools: [
      {
        id: "mcp.memory.search",
        description: "Search memory",
        effect: "read_only",
        keywords: ["memory"],
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
      },
    ],
    systemPrompt: "system prompt",
    identityPrompt: "identity",
    promptContractPrompt: "prompt contract",
    runtimePrompt: "runtime",
    safetyPrompt: "safety",
    sandboxPrompt: "sandbox",
    skillsText: "",
    toolsText: "",
    workOrchestrationText: undefined,
    memoryGuidanceText: undefined,
    conversationText: "conversation",
    workFocusText: "focus",
    preTurnTexts: [],
    preTurnReports: [
      {
        tool_id: "mcp.memory.seed",
        status: "succeeded",
        injected_chars: 18,
      },
    ],
    automationDirectiveText: undefined,
    automationContextText: undefined,
    memorySummary: {
      keyword_hits: 1,
      semantic_hits: 2,
      structured_hits: 0,
      included_items: 1,
    },
    automation: undefined,
    logger: { warn: vi.fn() },
  };
}

describe("agent runtime public tool ID emission", () => {
  beforeEach(() => {
    enqueueWsBroadcastMessageMock.mockReset();
  });

  it("canonicalizes context report tool identifiers at emission time", () => {
    const report = buildContextReport(createContextReportInput());

    expect(report.selected_tools).toEqual(["memory.search"]);
    expect(report.tool_schema_top).toContainEqual({
      id: "memory.search",
      chars: expect.any(Number),
    });
    expect(report.pre_turn_tools).toEqual([
      expect.objectContaining({
        tool_id: "memory.seed",
        status: "succeeded",
      }),
    ]);
  });

  it("preserves passthrough pre-turn report fields while canonicalizing tool ids", () => {
    const report = buildContextReport({
      ...createContextReportInput(),
      preTurnReports: [
        {
          tool_id: "mcp.memory.seed",
          status: "succeeded",
          injected_chars: 18,
          source: "preloaded-memory",
        },
      ],
    });

    expect(report.pre_turn_tools).toEqual([
      expect.objectContaining({
        tool_id: "memory.seed",
        source: "preloaded-memory",
      }),
    ]);
  });

  it("canonicalizes tool call report identifiers before attaching context", () => {
    const contextReport = {
      tool_calls: [],
      injected_files: [],
    } as AgentContextReport;

    recordToolResultContext(contextReport, {
      toolCallId: "tool-call-1",
      toolId: "mcp.memory.write",
      content: "stored memory",
      result: {
        tool_call_id: "tool-call-1",
        output: "ok",
      },
    });

    expect(contextReport.tool_calls).toEqual([
      {
        tool_call_id: "tool-call-1",
        tool_id: "memory.write",
        injected_chars: "stored memory".length,
      },
    ]);
  });

  it("canonicalizes tool lifecycle event payload identifiers before broadcast", async () => {
    await syncToolLifecycle(
      {
        conversationDal: undefined,
        tenantId: "tenant-1",
        agentId: "default",
        workspaceId: "default",
        wsEventDb: {} as NonNullable<Parameters<typeof syncToolLifecycle>[0]["wsEventDb"]>,
        logger: { info: vi.fn(), warn: vi.fn() },
      },
      {
        context: {
          conversationId: "conversation-1",
          channel: "ui",
          threadId: "thread-1",
        },
        toolCallId: "tool-call-1",
        toolId: "mcp.memory.write",
        status: "completed",
        summary: "Saved a durable memory.",
      },
    );

    expect(enqueueWsBroadcastMessageMock).toHaveBeenCalledTimes(1);
    expect(enqueueWsBroadcastMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      expect.objectContaining({
        type: "tool.lifecycle",
        payload: expect.objectContaining({
          tool_id: "memory.write",
          tool_call_id: "tool-call-1",
        }),
      }),
      expect.anything(),
    );
  });
});
