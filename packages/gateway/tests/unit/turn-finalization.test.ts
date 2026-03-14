import { describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";
import { finalizeTurn } from "../../src/modules/agent/runtime/turn-finalization.js";

function sampleInput(responseMessages: readonly ModelMessage[]) {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const replaceMessages = vi.fn(async () => undefined);
  const getById = vi.fn(async () => ({
    tenant_id: "tenant-1",
    session_id: sessionId,
    session_key: "agent:agent-1:main",
    title: "Existing title",
    messages: [],
  }));

  return {
    args: {
      container: {
        contextReportDal: { insert: vi.fn(async () => undefined) },
        logger: { warn: vi.fn(), info: vi.fn() },
      },
      sessionDal: {
        replaceMessages,
        getById,
        setTitleIfBlank: vi.fn(async () => undefined),
      },
      ctx: {
        config: {
          sessions: {
            loop_detection: {
              cross_turn: {
                enabled: false,
                window_assistant_messages: 3,
                similarity_threshold: 0.95,
                min_chars: 20,
                cooldown_assistant_messages: 1,
              },
            },
          },
        },
      },
      session: {
        tenant_id: "tenant-1",
        session_id: sessionId,
        session_key: "agent:agent-1:main",
        title: "Existing title",
        messages: [],
      },
      resolved: {
        message: "hello",
        channel: "ui",
        thread_id: "thread-1",
      },
      reply: "ok",
      model: {} as never,
      usedTools: new Set<string>(),
      memoryWritten: false,
      contextReport: {
        context_report_id: "report-1",
        generated_at: "2026-03-13T00:00:00.000Z",
        session_id: sessionId,
        thread_id: "thread-1",
        channel: "ui",
        agent_id: "agent-1",
        workspace_id: "workspace-1",
        tool_calls: [],
        injected_files: [],
      },
      responseMessages,
    } as const,
    replaceMessages,
  };
}

describe("finalizeTurn", () => {
  it("does not duplicate the triggering user message when responseMessages include it", async () => {
    const { args, replaceMessages } = sampleInput([
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      } as ModelMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "draft" }],
      } as ModelMessage,
    ]);

    await finalizeTurn(args);

    expect(replaceMessages).toHaveBeenCalledOnce();
    const persisted = replaceMessages.mock.calls[0]?.[0]?.messages;
    expect(persisted).toHaveLength(2);
    expect(persisted?.[0]?.role).toBe("user");
    expect(persisted?.[0]?.parts).toEqual([{ type: "text", text: "hello" }]);
    expect(persisted?.[1]?.role).toBe("assistant");
    expect(persisted?.[1]?.parts).toEqual([{ type: "text", text: "ok" }]);
  });
});
