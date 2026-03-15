import { describe, expect, it, vi } from "vitest";
import { runPreTurnHydration } from "../../src/modules/agent/runtime/preturn-hydration.js";
import type { ToolExecutor } from "../../src/modules/agent/tool-executor.js";
import type { SessionRow } from "../../src/modules/agent/session-dal.js";
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
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
    },
    required: ["query"],
  },
};

const session = {
  agent_id: "agent-1",
  workspace_id: "workspace-1",
  session_id: "session-1",
} as SessionRow;

const resolved = {
  channel: "chat",
  thread_id: "thread-1",
  message: "recall prior context",
} as ResolvedAgentTurnInput;

const toolExecutionContext: ToolExecutionContext = {
  tenantId: "tenant-1",
  planId: "plan-1",
  sessionId: "session-1",
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
      session,
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
        tool_id: memorySeedTool.id,
        status: "failed",
        injected_chars: 0,
        error: "policy store unavailable",
      },
    ]);
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
      session,
      resolved,
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(result.sections).toEqual([]);
    expect(result.reports).toEqual([
      {
        tool_id: memorySeedTool.id,
        status: "failed",
        injected_chars: 0,
        error: "executor crashed",
      },
    ]);
  });
});
