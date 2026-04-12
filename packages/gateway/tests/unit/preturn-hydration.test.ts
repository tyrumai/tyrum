import { describe, expect, it, vi } from "vitest";
import { runPreTurnHydration } from "../../src/modules/agent/runtime/preturn-hydration.js";
import type { ToolExecutor } from "../../src/modules/agent/tool-executor.js";
import type { ConversationRow } from "../../src/modules/agent/conversation-dal.js";
import type { ToolDescriptor } from "../../src/modules/agent/tools.js";
import type { ResolvedAgentTurnInput } from "../../src/modules/agent/runtime/turn-helpers.js";
import type {
  ToolExecutionContext,
  ToolSetBuilderDeps,
} from "../../src/modules/agent/runtime/tool-set-builder-helpers.js";

const memorySeedTool: ToolDescriptor = {
  id: "mcp.memory.seed",
  description: "Seed pre-turn memory context.",
  effect: "read_only",
  keywords: [],
  preTurnHydration: {
    promptArgName: "query",
    includeTurnContext: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
    },
    required: ["query"],
  },
};

const conversation = {
  agent_id: "agent-1",
  workspace_id: "workspace-1",
  conversation_id: "conversation-1",
} as ConversationRow;

const resolved = {
  channel: "chat",
  thread_id: "thread-1",
  message: "recall prior context",
} as ResolvedAgentTurnInput;

const toolExecutionContext: ToolExecutionContext = {
  tenantId: "tenant-1",
  planId: "plan-1",
  conversationId: "conversation-1",
  channel: "chat",
  threadId: "thread-1",
};

function createToolSetBuilderDeps(policyService: Partial<ToolSetBuilderDeps["policyService"]>) {
  return {
    home: "/tmp/tyrum-test",
    tenantId: "tenant-1",
    agentId: "agent-1",
    workspaceId: "workspace-1",
    policyService: {
      isEnabled: () => false,
      isObserveOnly: () => false,
      evaluateToolCall: vi.fn(async () => ({
        decision: "allow",
        applied_override_ids: [],
      })),
      ...policyService,
    },
    approvalDal: {} as never,
    approvalNotifier: { notify: vi.fn() } as never,
    approvalWaitMs: 1_000,
    approvalPollMs: 50,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
    },
  } as unknown as ToolSetBuilderDeps;
}

describe("runPreTurnHydration", () => {
  it("treats policy evaluation failures as best-effort skips", async () => {
    const result = await runPreTurnHydration({
      toolIds: [memorySeedTool.id],
      availableTools: [memorySeedTool],
      toolExecutor: { execute: vi.fn() } as unknown as ToolExecutor,
      toolSetBuilderDeps: createToolSetBuilderDeps({
        isEnabled: () => true,
        evaluateToolCall: vi.fn(async () => {
          throw new Error("policy store unavailable");
        }),
      }),
      toolExecutionContext,
      conversation,
      resolved,
    });

    expect(result.sections).toEqual([]);
    expect(result.memory).toEqual({
      keyword_hits: 0,
      semantic_hits: 0,
      structured_hits: 0,
      included_items: 0,
    });
    expect(result.reports).toEqual([
      {
        tool_id: "memory.seed",
        status: "failed",
        injected_chars: 0,
        error: "policy store unavailable",
      },
    ]);
  });

  it("uses explicit pre-turn hydration metadata for owned tools", async () => {
    const execute = vi.fn(async () => ({
      output: "Stored recall",
      error: undefined,
      meta: undefined,
    }));

    const result = await runPreTurnHydration({
      toolIds: [memorySeedTool.id],
      availableTools: [memorySeedTool],
      toolExecutor: { execute } as unknown as ToolExecutor,
      toolSetBuilderDeps: createToolSetBuilderDeps({}),
      toolExecutionContext,
      conversation,
      resolved,
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      memorySeedTool.id,
      expect.stringMatching(/^preturn-/),
      {
        query: resolved.message,
        turn: {
          agent_id: conversation.agent_id,
          workspace_id: conversation.workspace_id,
          conversation_id: conversation.conversation_id,
          channel: resolved.channel,
          thread_id: resolved.thread_id,
        },
      },
      {
        agent_id: conversation.agent_id,
        workspace_id: conversation.workspace_id,
        conversation_id: conversation.conversation_id,
        channel: resolved.channel,
        thread_id: resolved.thread_id,
      },
    );
    expect(result.sections).toEqual([
      {
        toolId: "memory.seed",
        text: "Pre-turn recall (memory.seed):\nStored recall",
      },
    ]);
    expect(result.reports).toEqual([
      {
        tool_id: "memory.seed",
        status: "succeeded",
        injected_chars: "Pre-turn recall (memory.seed):\nStored recall".length,
      },
    ]);
  });

  it("accepts canonical memory.seed config entries for legacy runtime tools", async () => {
    const execute = vi.fn(async () => ({
      output: "Stored recall",
      error: undefined,
      meta: undefined,
    }));

    const result = await runPreTurnHydration({
      toolIds: ["memory.seed"],
      availableTools: [memorySeedTool],
      toolExecutor: { execute } as unknown as ToolExecutor,
      toolSetBuilderDeps: createToolSetBuilderDeps({}),
      toolExecutionContext,
      conversation,
      resolved,
    });

    expect(execute).toHaveBeenCalledWith(
      memorySeedTool.id,
      expect.stringMatching(/^preturn-/),
      expect.any(Object),
      expect.any(Object),
    );
    expect(result.reports).toEqual([
      {
        tool_id: "memory.seed",
        status: "succeeded",
        injected_chars: "Pre-turn recall (memory.seed):\nStored recall".length,
      },
    ]);
  });

  it("falls back to schema inference for compatible MCP tools and logs the degraded path", async () => {
    const fallbackTool: ToolDescriptor = {
      ...memorySeedTool,
      id: "mcp.compatibility.seed",
      preTurnHydration: undefined,
    };
    const execute = vi.fn(async () => ({
      output: "Compatibility recall",
      error: undefined,
      meta: undefined,
    }));
    const deps = createToolSetBuilderDeps({});

    const result = await runPreTurnHydration({
      toolIds: [fallbackTool.id],
      availableTools: [fallbackTool],
      toolExecutor: { execute } as unknown as ToolExecutor,
      toolSetBuilderDeps: deps,
      toolExecutionContext,
      conversation,
      resolved,
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      fallbackTool.id,
      expect.stringMatching(/^preturn-/),
      {
        query: resolved.message,
        turn: expect.objectContaining({
          conversation_id: conversation.conversation_id,
          thread_id: resolved.thread_id,
        }),
      },
      expect.any(Object),
    );
    expect(deps.logger.warn).toHaveBeenCalledWith("agent.pre_turn_hydration_schema_fallback", {
      tool_id: fallbackTool.id,
    });
    expect(result.reports).toEqual([
      {
        tool_id: fallbackTool.id,
        status: "succeeded",
        injected_chars: "Pre-turn recall (mcp.compatibility.seed):\nCompatibility recall".length,
      },
    ]);
  });

  it("enriches memory.seed section text with retrieval metadata header", async () => {
    const execute = vi.fn(async () => ({
      output: "- [fact] abc (public) key=user value=Ron",
      error: undefined,
      meta: {
        kind: "memory.seed" as const,
        query: "recall prior context",
        keyword_hit_count: 3,
        semantic_hit_count: 1,
        structured_item_count: 2,
        included_item_ids: ["abc", "def", "ghi"],
      },
    }));

    const result = await runPreTurnHydration({
      toolIds: [memorySeedTool.id],
      availableTools: [memorySeedTool],
      toolExecutor: { execute } as unknown as ToolExecutor,
      toolSetBuilderDeps: createToolSetBuilderDeps({}),
      toolExecutionContext,
      conversation,
      resolved,
    });

    expect(result.sections).toHaveLength(1);
    const text = result.sections[0]!.text;
    expect(text).toContain('seed_query="recall prior context"');
    expect(text).toContain("structured=2");
    expect(text).toContain("keyword=3");
    expect(text).toContain("semantic=1");
    expect(text).toContain("included=3");
    expect(text).toContain("- [fact] abc (public) key=user value=Ron");
    expect(result.memory).toEqual({
      keyword_hits: 3,
      semantic_hits: 1,
      structured_hits: 2,
      included_items: 3,
    });
  });

  it("treats unexpected executor throws as best-effort skips", async () => {
    const execute = vi.fn(async () => {
      throw new Error("executor crashed");
    });

    const result = await runPreTurnHydration({
      toolIds: [memorySeedTool.id],
      availableTools: [memorySeedTool],
      toolExecutor: { execute } as unknown as ToolExecutor,
      toolSetBuilderDeps: createToolSetBuilderDeps({}),
      toolExecutionContext,
      conversation,
      resolved,
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(result.sections).toEqual([]);
    expect(result.reports).toEqual([
      {
        tool_id: "memory.seed",
        status: "failed",
        injected_chars: 0,
        error: "executor crashed",
      },
    ]);
  });
});
